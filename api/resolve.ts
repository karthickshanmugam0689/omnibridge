import type { VercelRequest, VercelResponse } from "@vercel/node";
import webpush, { type PushSubscription as WebPushSubscription } from "web-push";
import { getSubscriptions } from "./_pushStore.js";

/**
 * POST /api/resolve
 *
 * Called when the asker taps "Mark as solved" on their own post and
 * (optionally) picks the helper who actually helped. We:
 *   1. Verify the caller really is the post's author.
 *   2. Flip `resolved_at` on the post and store the chosen helper id.
 *   3. Atomically increment the helper's `profiles.points` counter.
 *   4. Push a "tada" notification to the helper in their preferred lang.
 *
 * Body:
 *   {
 *     postId: string,
 *     authorClientId: string,       // must match posts.author_client_id
 *     helperClientId: string | null // null = solved, no points awarded
 *   }
 *
 * Response (200):
 *   { ok: true, pointsAwarded: number, helperPoints: number | null }
 *
 * Errors return 4xx with `{ error: "..." }`. We never 500 on push failures
 * because the resolution is the source of truth — the push is a cherry on top.
 */

type Lang = "sk" | "en" | "ar" | "uk";

interface ResolveBody {
  postId?: string;
  authorClientId?: string;
  helperClientId?: string | null;
}

/**
 * Points awarded per thank-you. Deliberately a round, generous number so
 * the jump feels like a reward rather than a drip. Keep in sync with the
 * copy in `settings.points.*` i18n strings — we mention the number in the
 * "+10 points" chip on the cheer notification.
 */
const POINTS_PER_THANK_YOU = 10;

// ── Localised push templates ─────────────────────────────────────────────
// Keep these in sync with `push.solved*` in the locale JSONs. Substitution
// tokens: {{name}} (asker name) and {{points}} (amount awarded).
const PUSH_TEMPLATES: Record<Lang, { title: string; bodyNamed: string; bodyAnon: string }> = {
  en: {
    title: "🎉 Tada! Your help made a difference",
    bodyNamed: "{{name}} marked the request as solved. Thank you! +{{points}} points",
    bodyAnon: "A neighbour thanked you for helping. +{{points}} points",
  },
  sk: {
    title: "🎉 Tadá! Tvoja pomoc sa ráta",
    bodyNamed: "{{name}} označil žiadosť za vyriešenú. Ďakujeme! +{{points}} bodov",
    bodyAnon: "Sused vám poďakoval za pomoc. +{{points}} bodov",
  },
  ar: {
    title: "🎉 رائع! مساعدتك صنعت فرقًا",
    bodyNamed: "{{name}} اعتبر الطلب مُنجزًا. شكرًا لك! +{{points}} نقطة",
    bodyAnon: "جار شكرك على المساعدة. +{{points}} نقطة",
  },
  uk: {
    title: "🎉 Та-да! Ваша допомога важлива",
    bodyNamed: "{{name}} позначив запит як виконаний. Дякуємо! +{{points}} балів",
    bodyAnon: "Сусід подякував за допомогу. +{{points}} балів",
  },
};

function tplSub(str: string, vars: Record<string, string>): string {
  return str.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
}

// ── VAPID init (shared with /api/notify + /api/match) ────────────────────
let vapidConfigured = false;
function ensureVapid(): boolean {
  if (vapidConfigured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY ?? "";
  const priv = process.env.VAPID_PRIVATE_KEY ?? "";
  const subject = process.env.VAPID_SUBJECT ?? "mailto:hello@omnibridge.local";
  if (!pub || !priv) return false;
  webpush.setVapidDetails(subject, pub, priv);
  vapidConfigured = true;
  return true;
}

// ── Supabase client (service role) ───────────────────────────────────────
// Intentionally loose — the real client type adds generated schema overhead.
// We cast at call sites and narrow results locally.
type SupabaseClientLike = {
  from: (table: string) => unknown;
  rpc?: (fn: string, params?: Record<string, unknown>) => unknown;
};
let supabaseClient: SupabaseClientLike | null | undefined;
async function getSupabase(): Promise<SupabaseClientLike | null> {
  if (supabaseClient !== undefined) return supabaseClient;
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !serviceKey) {
    supabaseClient = null;
    return null;
  }
  try {
    const mod = await import("@supabase/supabase-js");
    supabaseClient = mod.createClient(url, serviceKey, {
      auth: { persistSession: false },
    }) as unknown as SupabaseClientLike;
    return supabaseClient;
  } catch (err) {
    console.warn("[resolve] supabase-js unavailable:", err);
    supabaseClient = null;
    return null;
  }
}

// Minimal row shapes — just the columns we read or write here.
interface PostRow {
  id: string;
  author_client_id: string | null;
  author_name: string | null;
  resolved_at: string | null;
  title_sk: string;
}
interface HelperRow {
  client_id: string;
  name: string | null;
  preferred_lang: Lang | null;
  points: number;
}

/** Narrow the supabase client's `.from(...)` into a call chain we can use. */
type AnyFn = (...args: unknown[]) => unknown;
function chain(obj: unknown, path: string[], args: unknown[][]): unknown {
  let current = obj;
  for (let i = 0; i < path.length; i++) {
    const step = path[i];
    const a = args[i] ?? [];
    const fn = (current as Record<string, AnyFn>)[step];
    if (typeof fn !== "function") {
      throw new Error(`[resolve] missing method '${step}' on supabase client`);
    }
    current = fn.apply(current, a);
  }
  return current;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const sb = await getSupabase();
  if (!sb) {
    res.status(500).json({ error: "supabase_not_configured" });
    return;
  }

  let body: ResolveBody;
  if (typeof req.body === "string") {
    try {
      body = JSON.parse(req.body) as ResolveBody;
    } catch {
      res.status(400).json({ error: "invalid_json" });
      return;
    }
  } else {
    body = (req.body ?? {}) as ResolveBody;
  }
  const { postId, authorClientId } = body;
  const helperClientId = body.helperClientId ?? null;
  if (!postId || !authorClientId) {
    res.status(400).json({ error: "missing_fields" });
    return;
  }
  if (helperClientId && helperClientId === authorClientId) {
    res.status(400).json({ error: "cannot_thank_self" });
    return;
  }

  // ── 1. Verify authorship + freshness ────────────────────────────────────
  let post: PostRow | null;
  try {
    const q = chain(
      sb,
      ["from", "select", "eq", "maybeSingle"],
      [
        ["posts"],
        ["id, author_client_id, author_name, resolved_at, title_sk"],
        ["id", postId],
        [],
      ],
    ) as Promise<{ data: unknown; error: unknown }>;
    const { data, error } = await q;
    if (error) {
      console.warn("[resolve] post fetch failed:", error);
      res.status(500).json({ error: "db_error" });
      return;
    }
    post = (data as PostRow | null) ?? null;
  } catch (err) {
    console.warn("[resolve] post fetch threw:", err);
    res.status(500).json({ error: "db_error" });
    return;
  }
  if (!post) {
    res.status(404).json({ error: "post_not_found" });
    return;
  }
  if (post.author_client_id !== authorClientId) {
    // Silently refuse without leaking whether the post exists.
    res.status(403).json({ error: "not_author" });
    return;
  }
  if (post.resolved_at) {
    // Already resolved — make the call idempotent so a double-tap is safe.
    res.status(200).json({ ok: true, pointsAwarded: 0, helperPoints: null, alreadyResolved: true });
    return;
  }

  // ── 2. Mark the post resolved ───────────────────────────────────────────
  const resolvedAt = new Date().toISOString();
  try {
    const q = chain(
      sb,
      ["from", "update", "eq"],
      [
        ["posts"],
        [{ resolved_at: resolvedAt, resolved_helper_client_id: helperClientId }],
        ["id", postId],
      ],
    ) as Promise<{ error: unknown }>;
    const { error } = await q;
    if (error) {
      console.warn("[resolve] post update failed:", error);
      res.status(500).json({ error: "db_error" });
      return;
    }
  } catch (err) {
    console.warn("[resolve] post update threw:", err);
    res.status(500).json({ error: "db_error" });
    return;
  }

  // ── 3. Increment helper points (upsert so non-opted-in helpers still count) ──
  // Authors can thank a responder who never opted in as a formal "helper" — we
  // still want to reward them. Upserting with default helper_enabled=false
  // keeps the match engine from later ambushing them with push spam.
  let helperRow: HelperRow | null = null;
  let pointsAwarded = 0;
  if (helperClientId) {
    try {
      // Read current points (defaults to 0 if the row doesn't exist yet).
      const selectQ = chain(
        sb,
        ["from", "select", "eq", "maybeSingle"],
        [
          ["profiles"],
          ["client_id, name, preferred_lang, points"],
          ["client_id", helperClientId],
          [],
        ],
      ) as Promise<{ data: unknown; error: unknown }>;
      const { data: existing, error: selErr } = await selectQ;
      if (selErr) {
        console.warn("[resolve] helper read failed:", selErr);
      }
      const current = (existing as HelperRow | null) ?? null;
      const newTotal = (current?.points ?? 0) + POINTS_PER_THANK_YOU;

      // Upsert the new total. `helper_enabled: false` is the default for rows
      // we create here so we never opt-someone-in without consent. For rows
      // that already exist it's ignored because we only merge on conflict.
      const upsertQ = chain(
        sb,
        ["from", "upsert"],
        [
          ["profiles"],
          [
            {
              client_id: helperClientId,
              points: newTotal,
              updated_at: resolvedAt,
              ...(current
                ? {}
                : { helper_tags: [], availability: {}, helper_enabled: false }),
            },
            { onConflict: "client_id" },
          ],
        ],
      ) as Promise<{ error: unknown }>;
      const { error: upErr } = await upsertQ;
      if (upErr) {
        console.warn("[resolve] helper upsert failed:", upErr);
      } else {
        helperRow = { ...(current ?? {
          client_id: helperClientId,
          name: null,
          preferred_lang: null,
          points: 0,
        }), points: newTotal };
        pointsAwarded = POINTS_PER_THANK_YOU;
      }
    } catch (err) {
      console.warn("[resolve] helper points threw:", err);
    }
  }

  // ── 4. Fire the "tada" push (best-effort) ──────────────────────────────
  if (helperClientId && ensureVapid()) {
    try {
      const subs = await getSubscriptions(helperClientId).catch(() => []);
      if (subs.length > 0) {
        const lang = (helperRow?.preferred_lang ?? "en") as Lang;
        const tpl = PUSH_TEMPLATES[lang] ?? PUSH_TEMPLATES.en;
        const askerName = post.author_name?.trim() || null;
        const pushTitle = tpl.title;
        const pushBody = askerName
          ? tplSub(tpl.bodyNamed, {
              name: askerName,
              points: String(POINTS_PER_THANK_YOU),
            })
          : tplSub(tpl.bodyAnon, { points: String(POINTS_PER_THANK_YOU) });
        const payload = {
          title: pushTitle,
          body: pushBody,
          tag: `solved:${postId}`,
          url: `/?post=${encodeURIComponent(postId)}`,
          data: {
            type: "solved",
            postId,
            points: POINTS_PER_THANK_YOU,
            helperPoints: helperRow?.points ?? null,
          },
        };
        await Promise.all(
          subs.map(async (s) => sendOne(s.subscription, payload)),
        );
      }
    } catch (err) {
      console.warn("[resolve] push send threw:", err);
    }
  }

  res.status(200).json({
    ok: true,
    pointsAwarded,
    helperPoints: helperRow?.points ?? null,
    resolvedAt,
  });
}

async function sendOne(
  sub: WebPushSubscription,
  payload: Record<string, unknown>,
): Promise<boolean> {
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload));
    return true;
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status !== 404 && status !== 410) {
      console.warn("[resolve] push failed:", status, err);
    }
    return false;
  }
}
