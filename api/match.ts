import type { VercelRequest, VercelResponse } from "@vercel/node";
import webpush, { type PushSubscription as WebPushSubscription } from "web-push";
import { getSubscriptions } from "./_pushStore.js";

/**
 * POST /api/match
 *
 * Called fire-and-forget from the client right after a new post lands in
 * Supabase. We look up volunteers whose profile matches the post's category
 * AND whose availability includes "now" (current weekday + time bucket), and
 * push a targeted notification to each.
 *
 * Body:
 *   {
 *     postId: string,
 *     category: Category,              // help | food | medical | …
 *     title: string,                   // author's original wording
 *     authorClientId: string | null,   // don't ping the author herself
 *     authorName?: string | null,      // used in the push body
 *     lang?: SourceLang,               // unused (recipient's preferred_lang wins)
 *   }
 *
 * Response: { alerted: number, skipped?: string }
 *
 * Runs on Node so we can use `web-push` for VAPID-signed pushes, matching
 * the style of /api/notify and /api/subscribe.
 *
 * Fails open on errors — this is a best-effort signal, not a source of truth.
 * The post itself still appears in everyone's feed regardless of push.
 */

type Day = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
type Bucket = "morning" | "afternoon" | "evening";
type Lang = "sk" | "en" | "ar" | "uk";

interface MatchBody {
  postId?: string;
  category?: string;
  title?: string;
  authorClientId?: string | null;
  authorName?: string | null;
  lang?: Lang;
  /**
   * Asker flagged this as urgent. When true we bypass the availability
   * filter (so helpers who are technically "off" still get pinged) and
   * swap to the `urgent*` push template with a siren emoji.
   */
  isUrgent?: boolean;
  /**
   * Asker's local day-of-week short key ("mon".."sun") and time bucket
   * ("morning"/"afternoon"/"evening", or null for 23:00–05:00). We use
   * these when present so the availability check respects the user's
   * timezone — Vercel runs in UTC and deriving the weekday on the server
   * would silently mismatch helpers in other timezones (Košice is UTC+1
   * or UTC+2 depending on DST). Falls back to server time when missing.
   */
  clientDay?: Day;
  clientBucket?: Bucket | null;
}

interface ProfileRow {
  client_id: string;
  name: string | null;
  emoji: string | null;
  preferred_lang: Lang | null;
  helper_tags: string[];
  availability: Partial<Record<Day, Bucket[]>>;
  helper_enabled: boolean;
}

// ── Localised push templates ─────────────────────────────────────────────
// We ship the four languages inline so the server doesn't need the full
// i18n bundle. Keep these strings in sync with `push.*` in the locale
// JSONs. `{{name}}` / `{{title}}` are simple substitutions.
const PUSH_TEMPLATES: Record<Lang, { title: string; bodyNamed: string; bodyAnon: string }> = {
  en: {
    title: "A neighbour needs help",
    bodyNamed: "{{name}} asked: {{title}}",
    bodyAnon: "Someone nearby asked: {{title}}",
  },
  sk: {
    title: "Sused potrebuje pomoc",
    bodyNamed: "{{name}} hľadá: {{title}}",
    bodyAnon: "Niekto v okolí hľadá: {{title}}",
  },
  ar: {
    title: "جار يحتاج إلى المساعدة",
    bodyNamed: "{{name}} يسأل: {{title}}",
    bodyAnon: "شخص قريب يسأل: {{title}}",
  },
  uk: {
    title: "Сусід потребує допомоги",
    bodyNamed: "{{name}} питає: {{title}}",
    bodyAnon: "Хтось поруч питає: {{title}}",
  },
};

// Urgent variant. Siren emoji on the title, stronger verb in the body.
// Used when /api/match is called with `isUrgent: true` — availability is
// ignored in that branch so every helper in the category hears the alarm.
const PUSH_TEMPLATES_URGENT: Record<Lang, { title: string; bodyNamed: string; bodyAnon: string }> = {
  en: {
    title: "🚨 Urgent: a neighbour needs help",
    bodyNamed: "{{name}} urgently needs: {{title}}",
    bodyAnon: "Urgent help needed: {{title}}",
  },
  sk: {
    title: "🚨 Súrne: sused potrebuje pomoc",
    bodyNamed: "{{name}} súrne potrebuje: {{title}}",
    bodyAnon: "Súrna pomoc: {{title}}",
  },
  ar: {
    title: "🚨 عاجل: جار يحتاج إلى المساعدة",
    bodyNamed: "{{name}} يحتاج بشكل عاجل إلى: {{title}}",
    bodyAnon: "مساعدة عاجلة مطلوبة: {{title}}",
  },
  uk: {
    title: "🚨 Терміново: сусід потребує допомоги",
    bodyNamed: "{{name}} терміново потребує: {{title}}",
    bodyAnon: "Термінова допомога: {{title}}",
  },
};

function tplSub(str: string, vars: Record<string, string>): string {
  return str.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
}

// ── VAPID init (shared with /api/notify) ─────────────────────────────────
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
// Lazy-loaded so module import doesn't require env vars to be set.
// Intentionally typed as `any` — the real SupabaseClient type would drag in
// a big generated schema and we only call one endpoint here. Cast at use.
type SupabaseClientLike = {
  from: (table: string) => {
    select: (cols: string) => {
      contains: (col: string, val: string[]) => {
        eq: (col: string, val: boolean) => Promise<{ data: unknown; error: unknown }>;
      };
    };
  };
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
    console.warn("[match] supabase-js unavailable:", err);
    supabaseClient = null;
    return null;
  }
}

// ── Time-bucket logic ────────────────────────────────────────────────────
// Matches the three bucket definitions used in the app:
//   morning   05:00–11:59
//   afternoon 12:00–16:59
//   evening   17:00–22:59
// 23:00–04:59 falls through to null (we don't ping at night).
function currentBucket(now = new Date()): Bucket | null {
  const h = now.getHours();
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 23) return "evening";
  return null;
}

const WEEKDAY_KEY: Day[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
function currentDay(now = new Date()): Day {
  return WEEKDAY_KEY[now.getDay()];
}

const DAY_SET: ReadonlySet<Day> = new Set<Day>([
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
]);
const BUCKET_SET: ReadonlySet<Bucket> = new Set<Bucket>([
  "morning",
  "afternoon",
  "evening",
]);
function isValidDay(v: unknown): v is Day {
  return typeof v === "string" && DAY_SET.has(v as Day);
}
function isValidBucket(v: unknown): v is Bucket {
  return typeof v === "string" && BUCKET_SET.has(v as Bucket);
}

// ── Handler ──────────────────────────────────────────────────────────────
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  if (!ensureVapid()) {
    res.status(200).json({ alerted: 0, skipped: "vapid_not_configured" });
    return;
  }
  const sb = await getSupabase();
  if (!sb) {
    res.status(200).json({ alerted: 0, skipped: "supabase_not_configured" });
    return;
  }
  let body: MatchBody;
  if (typeof req.body === "string") {
    try {
      body = JSON.parse(req.body) as MatchBody;
    } catch {
      res.status(400).json({ error: "invalid_json" });
      return;
    }
  } else {
    body = (req.body ?? {}) as MatchBody;
  }
  const { postId, category, title, authorClientId, authorName, isUrgent } = body;
  if (!postId || !category || !title) {
    res.status(400).json({ error: "missing_fields" });
    return;
  }

  // Prefer client-supplied day+bucket over server time. The server runs in
  // UTC on Vercel but both asker and helper live in the same local timezone
  // 99% of the time (Košice in the hackathon demo) — trusting the asker's
  // clock closes a 1–3 hour mismatch window. Falls back to server-derived
  // values when the client didn't send them (older bundle, replayed outbox).
  const today =
    isValidDay(body.clientDay) ? (body.clientDay as Day) : currentDay();
  const bucket =
    body.clientBucket === null
      ? null
      : isValidBucket(body.clientBucket)
        ? (body.clientBucket as Bucket)
        : currentBucket();
  // Outside our comfortable hours → silence for *non-urgent* posts only.
  // Urgent posts ring the bell regardless of wall-clock — that's the point.
  if (!bucket && !isUrgent) {
    res.status(200).json({
      alerted: 0,
      skipped: "outside_hours",
      debug: { today, bucket, usedClientTime: isValidDay(body.clientDay) },
    });
    return;
  }

  // Pull candidate helpers: anyone with helper_enabled=true whose tags
  // include this category. Availability gets filtered in JS because
  // Supabase can't index into a jsonb object easily, and the set of
  // volunteers is small enough for a single pass.
  let profiles: ProfileRow[] = [];
  try {
    const { data, error } = await sb
      .from("profiles")
      .select(
        "client_id, name, emoji, preferred_lang, helper_tags, availability, helper_enabled",
      )
      .contains("helper_tags", [category])
      .eq("helper_enabled", true);
    if (error) {
      console.warn("[match] profiles query failed:", error);
      res.status(200).json({ alerted: 0, skipped: "db_query_failed" });
      return;
    }
    profiles = (Array.isArray(data) ? data : []) as ProfileRow[];
  } catch (err) {
    console.warn("[match] profiles threw:", err);
    res.status(200).json({ alerted: 0, skipped: "db_threw" });
    return;
  }

  const matched = profiles.filter((p) => {
    if (authorClientId && p.client_id === authorClientId) return false;
    // Urgent posts skip the availability check entirely — we want everyone
    // who opted in for the category to hear about it, even if it's "their
    // weekend". That's the whole contract of the urgent flag.
    if (isUrgent) return true;
    if (!bucket) return false;
    const buckets = p.availability?.[today] ?? [];
    return buckets.includes(bucket);
  });

  // Send a tailored push to each match. We look up their subscriptions by
  // client_id, localise the payload to their preferred_lang, and fire them
  // in parallel. We count a client as "alerted" if at least one of their
  // subscriptions accepted the push.
  const outcomes = await Promise.all(
    matched.map(async (p) => {
      const subs = await getSubscriptions(p.client_id).catch(() => []);
      if (subs.length === 0) return false;
      const lang = (p.preferred_lang ?? "en") as Lang;
      const tplSet = isUrgent ? PUSH_TEMPLATES_URGENT : PUSH_TEMPLATES;
      const tpl = tplSet[lang] ?? tplSet.en;
      const pushTitle = tpl.title;
      const pushBody = authorName
        ? tplSub(tpl.bodyNamed, { name: authorName, title })
        : tplSub(tpl.bodyAnon, { title });
      const payload = {
        title: pushTitle,
        body: pushBody,
        tag: `match:${postId}`,
        url: `/?post=${encodeURIComponent(postId)}`,
        // `requireInteraction` keeps the urgent notification on-screen until
        // the helper taps/dismisses it — supported on desktop Chrome/Edge.
        // Silently ignored elsewhere; we never want urgent pushes to pop
        // and auto-dismiss after 5 s.
        requireInteraction: isUrgent === true,
        data: { type: "match_request", postId, urgent: isUrgent === true },
      };
      const results = await Promise.all(
        subs.map(async (s) => sendOne(s.subscription, payload)),
      );
      return results.some((r) => r);
    }),
  );

  const alerted = outcomes.filter(Boolean).length;
  res.status(200).json({
    alerted,
    candidates: matched.length,
    // Small debug envelope so the author's UI can explain "we didn't ping
    // anyone because…" instead of silently showing nothing. `profilesChecked`
    // is the total count before the availability filter, so a value of 0
    // there means "literally no helper has opted in for this category".
    debug: {
      profilesChecked: profiles.length,
      today,
      bucket,
      usedClientTime: isValidDay(body.clientDay),
      isUrgent: isUrgent === true,
    },
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
      console.warn("[match] push failed:", status, err);
    }
    return false;
  }
}
