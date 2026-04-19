import i18next from "i18next";
import { db } from "./db";
import { supabase, hasSupabase } from "./supabase";
import { useAppStore } from "@/store/useAppStore";
import { translateAllLangs } from "./translate";
import { SUPPORTED_LANGUAGES } from "@/i18n";
import type { Post, Response, SourceLang, Translations } from "./types";

/**
 * Reply / response data layer.
 *
 * Mirrors the shape of `src/lib/posts.ts`:
 *   - Local-first: every write lands in Dexie immediately so the UI is instant.
 *   - Online: also writes to Supabase (when configured + reachable).
 *   - Offline: queues into `db.responseOutbox` to be flushed by `syncResponseOutbox()`.
 *
 * After a successful response create we fire-and-forget a Web Push to the
 * post author's devices via `/api/notify`. This is best-effort — failures
 * are logged but never block the local UX.
 */

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function effectiveOnline(): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return false;
  return !useAppStore.getState().offlineDemo;
}

export interface CreateResponseInput {
  postId: string;
  message: string;
  /** Optional override; defaults to the user's stored profile. */
  author_name?: string;
  author_emoji?: string;
  /** Marks this response as a one-tap "Yes, I can help" offer. */
  is_offer?: boolean;
  /**
   * Private 1-to-1 reply. When true, `visible_to` must include both the
   * asker's and helper's client_ids — everyone else's client filters it out.
   */
  is_private?: boolean;
  visible_to?: string[];
  /**
   * Pre-computed translations. When provided we skip the LLM round-trip —
   * used for "Yes, I can help" offers where the text is a fixed i18n string
   * available in all languages already.
   */
  message_translations?: Translations;
}

export interface CreateResponseResult {
  response: Response;
  queued: boolean;
  notified: boolean;
}

/** Build the fixed "I can help" body in every supported language. */
export function buildOfferTranslations(): Translations {
  const out: Partial<Translations> = {};
  for (const lang of SUPPORTED_LANGUAGES) {
    // `i18next.getFixedT` pulls the right bundle without mutating the
    // viewer's current language. Falls back to the viewer's language
    // when a bundle hasn't loaded yet (rare, but possible on first boot).
    const t = i18next.getFixedT(lang);
    out[lang as SourceLang] = t("responses.offerBody");
  }
  return out as Translations;
}

/**
 * Persist a reply locally + remotely, then nudge the post author via push.
 * The push step needs to know who the post belongs to, so we look up the
 * post in Dexie by id; that read also gives us a nice notification body.
 */
export async function createResponse(input: CreateResponseInput): Promise<CreateResponseResult> {
  const message = input.message.trim();
  if (!message) throw new Error("response_message_empty");

  const state = useAppStore.getState();
  const user = state.user;
  const sourceLang = state.language as SourceLang;

  // Translation strategy mirrors createPost: don't block the reply on the
  // LLM. We seed the row with the author's exact wording in every slot
  // (so viewers in other languages at least see something readable), push
  // to Supabase + fire the notify push immediately, then translate in the
  // background and UPDATE the row. Typical reply lands in ~500 ms instead
  // of 2–5 s, and the push to the asker fires just as fast.
  //
  // Skip background translation entirely when the caller supplied fixed
  // i18n-sourced strings (e.g. "Yes, I can help" offers) — those are
  // already correct in every language.
  const preTranslated = Boolean(input.message_translations);
  const messageTranslations: Translations = preTranslated
    ? { ...(input.message_translations as Translations), [sourceLang]: message }
    : {
        sk: sourceLang === "sk" ? message : undefined,
        en: sourceLang === "en" ? message : undefined,
        ar: sourceLang === "ar" ? message : undefined,
        uk: sourceLang === "uk" ? message : undefined,
      };

  const now = new Date().toISOString();
  const response: Response = {
    id: uuid(),
    post_id: input.postId,
    author_client_id: user.clientId,
    author_name: input.author_name ?? user.name ?? null,
    author_emoji: input.author_emoji ?? user.emoji ?? null,
    message,
    source_lang: sourceLang,
    message_translations: messageTranslations,
    is_offer: input.is_offer ?? false,
    is_private: input.is_private ?? false,
    visible_to: input.visible_to ?? null,
    created_at: now,
  };

  await db.responses.put(response);

  let queued = false;
  if (hasSupabase && supabase && effectiveOnline()) {
    try {
      const { error } = await supabase.from("responses").insert(response);
      if (error) throw error;
    } catch (err) {
      console.warn("[responses] insert failed, queuing:", err);
      queued = true;
    }
  } else {
    queued = true;
  }
  if (queued) {
    await db.responseOutbox.put({
      id: response.id,
      response,
      queued_at: now,
      attempts: 0,
    });
  }

  // Fire-and-forget notification to the post author. We deliberately don't
  // await because (a) the responder shouldn't see latency from a third-party
  // push service and (b) failures here must never block the reply landing.
  let notified = false;
  void notifyPostAuthor(response).then((ok) => {
    notified = ok;
  });

  // Background LLM translation. We skip when the caller passed
  // `message_translations` because those are already-translated i18n
  // strings — no round-trip needed, and re-translating would clobber
  // the exact wording we just saved.
  if (!preTranslated) {
    void translateResponseInBackground(response, sourceLang, message);
  }

  return { response, queued, notified };
}

/**
 * Run translation for a just-sent response off the critical path and
 * write the filled-in translations back to Dexie + Supabase. Silent on
 * error — the source-language text in every slot is a passable fallback
 * for viewers in other languages until a later reply triggers a refresh.
 */
async function translateResponseInBackground(
  response: Response,
  sourceLang: SourceLang,
  message: string,
): Promise<void> {
  try {
    const { translations } = await translateAllLangs(message, sourceLang);
    // Pin the source-language slot to the exact original wording so the
    // LLM never rephrases the author back at themselves.
    const full: Translations = { ...translations, [sourceLang]: message };
    const patch = { message_translations: full };
    await db.responses.where("id").equals(response.id).modify(patch);
    if (hasSupabase && supabase && effectiveOnline()) {
      const { error } = await supabase
        .from("responses")
        .update(patch)
        .eq("id", response.id);
      if (error) {
        console.warn("[responses] translation update failed:", error);
      }
    }
  } catch (err) {
    console.warn("[responses] background translate failed:", err);
  }
}

/** Pick the best string for a given viewer language, falling back gracefully. */
function pickLang(
  translations: Translations | null | undefined,
  fallbackSk: string | null | undefined,
  fallbackOriginal: string,
  viewerLang: SourceLang,
): string {
  if (viewerLang === "sk") return fallbackSk ?? fallbackOriginal;
  const t = translations ?? {};
  return t[viewerLang] ?? fallbackSk ?? fallbackOriginal;
}

/**
 * Look up the post in Dexie and call /api/notify with a nice payload.
 *
 * Routing rules:
 *   - normal public reply  → notify post author
 *   - "I can help" offer   → notify post author with "offer received" payload
 *   - private 1-to-1 reply → notify the OTHER client in `visible_to`
 */
async function notifyPostAuthor(response: Response): Promise<boolean> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return false;
  if (useAppStore.getState().offlineDemo) return false;

  let post: Post | undefined;
  try {
    post = await db.posts.get(response.post_id);
  } catch (err) {
    console.warn("[responses] could not look up post for push:", err);
    return false;
  }
  if (!post?.author_client_id) return false;

  // Figure out who we're pinging.
  let targetClientId: string;
  if (response.is_private && response.visible_to?.length) {
    // Private reply: whoever in visible_to ISN'T the sender.
    const other = response.visible_to.find((id) => id !== response.author_client_id);
    if (!other) return false;
    targetClientId = other;
  } else {
    // Public reply or offer: the post author.
    if (post.author_client_id === response.author_client_id) return false;
    targetClientId = post.author_client_id;
  }

  // Localise the push into the *recipient's* language.
  // - For public replies we don't know the recipient's preferred_lang from
  //   Dexie; we fall back to the post's source_lang which is the author's.
  // - For private replies the recipient might be a helper in a different
  //   language than the post author; same best-effort fallback.
  const recipientLang = (post.source_lang ?? "sk") as SourceLang;
  const t = i18next.getFixedT(recipientLang);

  const titleLocalised = pickLang(post.title_translations, post.title_sk, post.title_sk, recipientLang);
  const messageLocalised = pickLang(
    response.message_translations,
    response.message_translations?.sk,
    response.message,
    recipientLang,
  );

  const responder = response.author_emoji
    ? `${response.author_emoji} ${response.author_name ?? "Someone"}`
    : response.author_name ?? "Someone";

  let pushTitle: string;
  let pushBody: string;
  let data: Record<string, unknown> = {
    postId: post.id,
    responseId: response.id,
    type: "response",
  };

  if (response.is_offer) {
    pushTitle = t("push.offerReceivedTitle", { defaultValue: "Someone can help" });
    pushBody = t("push.offerReceivedBody", {
      name: responder,
      title: titleLocalised,
      defaultValue: "{{name}} is ready to help with: {{title}}",
    });
    data = { ...data, type: "offer" };
  } else if (response.is_private) {
    pushTitle = `🔒 ${responder}`;
    pushBody = messageLocalised.slice(0, 180);
    data = { ...data, type: "private" };
  } else {
    pushTitle = `${responder} replied`;
    pushBody = `${titleLocalised}: ${messageLocalised}`.slice(0, 180);
  }

  const payload = {
    title: pushTitle,
    body: pushBody,
    tag: response.is_private ? `dm:${post.id}:${response.author_client_id}` : `post:${post.id}`,
    url: `/?post=${encodeURIComponent(post.id)}`,
    data,
  };

  try {
    const resp = await fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // keepalive lets the browser finish this POST even if the user
      // navigates away / locks the phone right after hitting "Send". Without
      // it, mobile tabs aggressively cancel in-flight fetches which is the
      // main reason replies sometimes don't ping the author.
      keepalive: true,
      body: JSON.stringify({ targetClientId, payload }),
    });
    if (!resp.ok) {
      console.warn("[responses] /api/notify returned", resp.status);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[responses] /api/notify unreachable:", err);
    return false;
  }
}

/**
 * Demo helper: send a real Web Push notification to *this* device, by routing
 * a fake reply through the same /api/notify path we use for real replies.
 * Used by the "Send test reply" button when there's no second device handy.
 */
export async function sendDemoReplyNotification(post: Post): Promise<boolean> {
  const { currentSubscription } = await import("./push");
  const sub = await currentSubscription();
  if (!sub) return false;
  const payload = {
    title: "🌻 Marek replied",
    body: `${post.title_sk}: I have some, where can we meet?`.slice(0, 180),
    tag: `post:${post.id}`,
    url: `/?post=${encodeURIComponent(post.id)}`,
    data: { postId: post.id, demo: true },
  };
  try {
    const resp = await fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: sub, payload }),
    });
    return resp.ok;
  } catch (err) {
    console.warn("[responses] demo notify failed:", err);
    return false;
  }
}

export async function getCachedResponses(postId: string): Promise<Response[]> {
  return db.responses
    .where("[post_id+created_at]")
    .between([postId, ""], [postId, "\uffff"])
    .toArray();
}

export async function refreshResponses(postId: string): Promise<Response[]> {
  if (hasSupabase && supabase && effectiveOnline()) {
    try {
      const { data, error } = await supabase
        .from("responses")
        .select("*")
        .eq("post_id", postId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      if (data) {
        await db.responses.bulkPut(data as Response[]);
      }
    } catch (err) {
      console.warn("[responses] refresh failed, using cache:", err);
    }
  }
  return getCachedResponses(postId);
}

/** Attempt to flush every queued response. */
export async function syncResponseOutbox(): Promise<number> {
  if (!hasSupabase || !supabase || !effectiveOnline()) return 0;
  const queued = await db.responseOutbox.toArray();
  let sent = 0;
  for (const item of queued) {
    try {
      const { error } = await supabase.from("responses").insert(item.response);
      if (error) throw error;
      await db.responseOutbox.delete(item.id);
      sent += 1;
    } catch (err) {
      console.warn("[responses] outbox item failed:", item.id, err);
      await db.responseOutbox.update(item.id, { attempts: item.attempts + 1 });
    }
  }
  return sent;
}
