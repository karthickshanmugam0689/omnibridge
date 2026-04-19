import { db } from "./db";
import { supabase, hasSupabase } from "./supabase";
import { translateAllLangs } from "./translate";
import { embedPost } from "./embeddings";
import { useAppStore } from "@/store/useAppStore";
import type { Bucket, Category, Day, Post, SourceLang, Translations } from "./types";

/** True if the network is available AND the user hasn't enabled the offline demo toggle. */
function effectiveOnline(): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return false;
  return !useAppStore.getState().offlineDemo;
}

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Refresh the feed from Supabase and cache it in Dexie.
 * Safe to call offline — it will silently fall back to the cache.
 */
export async function refreshFeed(): Promise<Post[]> {
  if (hasSupabase && supabase && effectiveOnline()) {
    try {
      const { data, error } = await supabase
        .from("posts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      if (data) {
        await db.posts.clear();
        await db.posts.bulkPut(data as Post[]);
      }
    } catch (err) {
      console.warn("[posts] refreshFeed failed, using cache:", err);
    }
  }
  return db.posts.orderBy("created_at").reverse().toArray();
}

export async function getCachedFeed(): Promise<Post[]> {
  return db.posts.orderBy("created_at").reverse().toArray();
}

export interface CreatePostInput {
  author_name: string;
  author_emoji: string;
  category: Category;
  /** The title as the author typed it, in their own language. */
  title: string;
  /** Optional body text in the same language as the title. */
  body?: string;
  /** The language the author is writing in; defaults to current UI language. */
  source_lang?: SourceLang;
  location?: string;
  is_resource?: boolean;
  /**
   * When true, the post is flagged as an emergency. The server's match
   * engine ignores helper availability and pushes every opted-in helper
   * in the category; the feed card renders with a red halo. Defaults to
   * false. Ignored when `is_resource` is true — resources can't be urgent.
   */
  is_urgent?: boolean;
}

/**
 * Create a post. Optimised for perceived latency:
 *   1. Seed the post with only the author's source-language text (no LLM
 *      call on the critical path). `title_sk` / `body_sk` are filled with
 *      the original text as a first-pass fallback so Dexie's Slovak-keyed
 *      indexes don't go empty.
 *   2. Insert into Supabase + fire `/api/match` immediately. This is the
 *      part that triggers push notifications — so helpers get pinged in
 *      ~500 ms instead of waiting 3–5 s for translation.
 *   3. Kick off `translateAllLangs` for title + body IN PARALLEL in the
 *      background. When it finishes we UPDATE the post row with the real
 *      translations. Feed viewers in other languages will get the fully
 *      translated version on next refresh (typically within a second of
 *      the push).
 *
 * Writes through to Supabase when online, otherwise queues in the Dexie
 * outbox. Always updates the local cache immediately so the UI is instant.
 *
 * Resilient insert: if Supabase rejects the row because `is_urgent`
 * doesn't exist yet (migration-v3 not run), we strip the column and
 * retry — so an out-of-date DB doesn't silently drop the post into the
 * offline queue.
 */
export async function createPost(input: CreatePostInput): Promise<{ post: Post; queued: boolean }> {
  const sourceLang: SourceLang =
    input.source_lang ?? (useAppStore.getState().language as SourceLang);
  const titleInput = input.title.trim();
  const bodyInput = input.body?.trim() ?? "";

  // Seed all four translation slots with the ORIGINAL text in the author's
  // language. Viewers in a different UI language see the source text until
  // the background translation pass lands — much better UX than an empty
  // card, and matches how most messaging apps behave ("sending…").
  const titleTranslations: Translations = {
    en: sourceLang === "en" ? titleInput : undefined,
    ar: sourceLang === "ar" ? titleInput : undefined,
    uk: sourceLang === "uk" ? titleInput : undefined,
  };
  const bodyTranslations: Translations | null = bodyInput
    ? {
        en: sourceLang === "en" ? bodyInput : undefined,
        ar: sourceLang === "ar" ? bodyInput : undefined,
        uk: sourceLang === "uk" ? bodyInput : undefined,
      }
    : null;

  const now = new Date().toISOString();
  const post: Post = {
    id: uuid(),
    author_name: input.author_name || null,
    author_emoji: input.author_emoji || null,
    // Tag the post with this device's anonymous id so /api/notify can route
    // future replies back to the author's other devices.
    author_client_id: useAppStore.getState().user.clientId || null,
    source_lang: sourceLang,
    category: input.category,
    // Until the LLM fills these in, `title_sk` is whatever the author
    // typed — correct when source_lang is `"sk"`, a stand-in otherwise.
    // `updatePostTranslations` (below) overwrites it with the true Slovak
    // translation once the LLM returns.
    title_sk: titleInput,
    title_translations: titleTranslations,
    body_sk: bodyInput || null,
    body_translations: bodyTranslations,
    is_resource: input.is_resource ?? false,
    // Resources (pharmacy hours, soup kitchens, …) can't be urgent — the
    // is_urgent flag is only meaningful on a help request.
    is_urgent: !input.is_resource && input.is_urgent === true,
    last_status: null,
    location: input.location ?? null,
    created_at: now,
  };

  await db.posts.put(post);

  let queued = true;
  if (hasSupabase && supabase && effectiveOnline()) {
    const ok = await insertPostResilient(post);
    if (ok) {
      queued = false;
      // Fire-and-forget volunteer matching. The server finds opted-in
      // helpers whose tags + availability match "now" and pushes them.
      // Do NOT await: we want createPost to return as soon as the post is
      // in the DB so the UI can flash "Posted!" and navigate home.
      if (!post.is_resource) void triggerMatch(post);
    }
  }

  if (queued) {
    await db.outbox.put({
      id: post.id,
      post,
      queued_at: now,
      attempts: 0,
    });
  }

  // Background work — neither the caller nor the UI waits on these.
  //   1. Translation: LLM call (2–5 s) that backfills other languages.
  //   2. Embedding: on-device model warmup + vectorization, used by
  //      offline semantic search. Safe to run anytime; the post already
  //      appears in keyword search without it.
  void translateInBackground(post, sourceLang, titleInput, bodyInput);
  void embedPost(post).catch((err) => {
    console.warn("[posts] embed failed:", err);
  });

  return { post, queued };
}

/**
 * Run the Supabase insert and — if it fails with "is_urgent does not
 * exist" (i.e. the v3 migration hasn't been applied yet) — retry with
 * that column stripped out. Returns true on success.
 *
 * This exists because otherwise a forgotten migration silently drops
 * every new post into the offline outbox, and the user just thinks
 * "push doesn't work" when actually nothing was posted.
 */
async function insertPostResilient(post: Post): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { error } = await supabase.from("posts").insert(post);
    if (!error) return true;

    // Supabase surfaces schema errors as PostgrestError; the shape varies
    // slightly across versions but `message` + `code` are stable.
    const errInfo = error as { message?: string; code?: string };
    const missingUrgent =
      /is_urgent/.test(errInfo.message ?? "") ||
      errInfo.code === "PGRST204"; // "could not find column … in schema cache"
    if (missingUrgent) {
      console.warn(
        "[posts] DB missing is_urgent column — retry without it. " +
          "Run supabase/migrate-v3.sql to restore urgent support.",
      );
      // Cast-then-delete pattern: TypeScript can't prove the assignment
      // to an optional is fine, so we fall to an index-signature view.
      const { is_urgent: _ignored, ...rest } = post;
      void _ignored;
      const { error: retryError } = await supabase
        .from("posts")
        .insert(rest as Omit<Post, "is_urgent">);
      if (!retryError) return true;
      console.warn("[posts] insert retry also failed:", retryError);
      return false;
    }
    console.warn("[posts] insert failed, queuing:", error);
    return false;
  } catch (err) {
    console.warn("[posts] insert threw, queuing:", err);
    return false;
  }
}

/**
 * Translate the post's title + body off the critical path and write the
 * results back to both Dexie and Supabase. Parallelises the two LLM
 * calls so latency is dominated by the slower of the two, not the sum.
 *
 * Silently no-ops on error — the post is still visible in its source
 * language and a later `refreshFeed` will see whatever translations did
 * succeed. Never throws: we don't want a background task to unhandled-
 * reject and spam the console.
 */
async function translateInBackground(
  post: Post,
  sourceLang: SourceLang,
  titleInput: string,
  bodyInput: string,
): Promise<void> {
  try {
    const [titleResult, bodyResult] = await Promise.all([
      translateAllLangs(titleInput, sourceLang),
      bodyInput ? translateAllLangs(bodyInput, sourceLang) : Promise.resolve(null),
    ]);

    // Pin the source-language slot to the exact original wording (never
    // let the LLM rephrase a Slovak author back at themselves).
    const titleAll: Translations = {
      ...titleResult.translations,
      [sourceLang]: titleInput,
    };
    const bodyAll: Translations | null = bodyResult
      ? { ...bodyResult.translations, [sourceLang]: bodyInput }
      : null;

    const titleSk = titleAll.sk ?? titleInput;
    const bodySk = bodyAll ? bodyAll.sk ?? bodyInput : null;
    const titleTranslations: Translations = {
      en: titleAll.en,
      ar: titleAll.ar,
      uk: titleAll.uk,
    };
    const bodyTranslations: Translations | null = bodyAll
      ? { en: bodyAll.en, ar: bodyAll.ar, uk: bodyAll.uk }
      : null;

    const patch = {
      title_sk: titleSk,
      title_translations: titleTranslations,
      body_sk: bodySk,
      body_translations: bodyTranslations,
    };

    // Local cache first — guarantees the author sees the fully-translated
    // row even if the Supabase round-trip drops on their way back to the
    // feed. `modify` is a merge rather than a full-row put to avoid
    // overwriting any fields that changed between our initial insert and
    // now (e.g. someone on another device marked it resolved).
    await db.posts.where("id").equals(post.id).modify(patch);

    // Then push the same patch to Supabase. Fails quietly — the client
    // keeps the authoritative local cache, and the next refresh will
    // reconcile. We do this outside an await-boundary: the UI has long
    // since returned to the feed, so a 5 s network stall here is fine.
    if (hasSupabase && supabase && effectiveOnline()) {
      const { error } = await supabase
        .from("posts")
        .update(patch)
        .eq("id", post.id);
      if (error) {
        console.warn("[posts] translation update failed:", error);
      }
    }
  } catch (err) {
    console.warn("[posts] background translate failed:", err);
  }
}

/**
 * Ping the server-side match engine so opted-in volunteers get a targeted
 * push. Pure side-effect — never blocks or throws up to the caller.
 *
 * Uses the author's OWN language for the title (kept exactly as typed). The
 * server localises the "A neighbour needs help" wrapper to each recipient's
 * preferred_lang, so a Slovak asker + Arabic helper still reads correctly.
 */
/**
 * Convert "right now on the user's device" into the same day + bucket
 * keys that helpers use to declare availability. Server runs in UTC so
 * if we don't pass this, helpers in other timezones get mis-matched by
 * up to 2 hours per day. See api/match.ts: clientDay/clientBucket.
 */
const CLIENT_WEEKDAY: Day[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
function clientLocalDay(now = new Date()): Day {
  return CLIENT_WEEKDAY[now.getDay()];
}
function clientLocalBucket(now = new Date()): Bucket | null {
  const h = now.getHours();
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 23) return "evening";
  return null;
}

async function triggerMatch(post: Post): Promise<void> {
  try {
    const sourceLang = (post.source_lang ?? "sk") as SourceLang;
    // Prefer the source-language title so the recipient sees what the
    // author actually wrote. The wrapper ("A neighbour needs help") gets
    // localised per-recipient on the server.
    const title =
      (sourceLang === "sk" ? post.title_sk : post.title_translations?.[sourceLang as "en" | "ar" | "uk"]) ||
      post.title_sk;
    const resp = await fetch("/api/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // `keepalive: true` tells the browser to let this POST finish even
      // if the tab is being navigated/closed/backgrounded. Without it,
      // mobile users who tap "Post" and immediately pocket their phone
      // have a good chance of the match call getting cancelled mid-flight
      // → no push notification fires. This is the main difference between
      // "works on laptop" and "flaky on mobile" that users report.
      keepalive: true,
      body: JSON.stringify({
        postId: post.id,
        category: post.category,
        title,
        authorClientId: post.author_client_id ?? null,
        authorName: post.author_name ?? null,
        lang: sourceLang,
        isUrgent: post.is_urgent === true,
        // Asker's local weekday + bucket. The server uses these to filter
        // helpers by availability instead of its own UTC clock — closes
        // the timezone mismatch bug.
        clientDay: clientLocalDay(),
        clientBucket: clientLocalBucket(),
      }),
    });
    // Store the outcome so the author's PostCard can display a small
    // "N helpers alerted" chip. We don't await Supabase realtime for this —
    // the moment of posting is when the author most wants reassurance.
    if (resp.ok) {
      try {
        const data = (await resp.json()) as {
          alerted?: number;
          candidates?: number;
          skipped?: string;
          debug?: { profilesChecked?: number };
        };
        useAppStore.getState().setMatchStats(post.id, {
          alerted: data.alerted ?? 0,
          candidates: data.candidates ?? 0,
          skipped: data.skipped,
          profilesChecked: data.debug?.profilesChecked,
        });
      } catch {
        // Non-JSON body is fine — the endpoint can also return 200 with no body.
      }
    }
  } catch (err) {
    console.warn("[posts] /api/match unreachable:", err);
  }
}

export interface ResolvePostResult {
  ok: boolean;
  /** Points awarded to the chosen helper, 0 when no helper was picked. */
  pointsAwarded: number;
  /** Helper's new lifetime points total (null when no helper). */
  helperPoints: number | null;
  /** True when the post was already resolved before this call. */
  alreadyResolved?: boolean;
}

/**
 * Mark a post as solved and (optionally) thank a helper with points.
 *
 * The asker must be the post author. We optimistically update the local
 * Dexie cache so the UI shows the green "Solved" state instantly, then
 * call `/api/resolve` which:
 *   - verifies author_client_id server-side
 *   - atomically bumps profiles.points for the helper
 *   - pushes a "tada" notification to the helper's devices
 *
 * Throws when the request fails so callers can surface a toast. Resolves
 * with `alreadyResolved=true` if the server says the post was already
 * closed — the local cache is re-synced with the authoritative row in
 * that branch so the UI doesn't stay stuck on a stale state.
 */
export async function resolvePost(
  postId: string,
  helperClientId: string | null,
): Promise<ResolvePostResult> {
  const state = useAppStore.getState();
  const authorClientId = state.user.clientId;
  if (!authorClientId) throw new Error("resolve_no_client_id");

  const existing = await db.posts.get(postId);
  if (!existing) throw new Error("resolve_post_missing");
  if (existing.author_client_id && existing.author_client_id !== authorClientId) {
    throw new Error("resolve_not_author");
  }
  if (existing.resolved_at) {
    return { ok: true, pointsAwarded: 0, helperPoints: null, alreadyResolved: true };
  }

  // Optimistic local update — the UI flips to "Solved" immediately even if
  // the network call is slow. We roll back on server failure below.
  const optimisticResolvedAt = new Date().toISOString();
  await db.posts.put({
    ...existing,
    resolved_at: optimisticResolvedAt,
    resolved_helper_client_id: helperClientId,
  });

  if (!hasSupabase || !effectiveOnline()) {
    // Offline: keep the optimistic local state so the author sees progress,
    // but don't fake points — those only land when the server upserts.
    return { ok: true, pointsAwarded: 0, helperPoints: null };
  }

  try {
    const resp = await fetch("/api/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId, authorClientId, helperClientId }),
    });
    if (!resp.ok) {
      // Roll back the optimistic local update so the author can retry.
      await db.posts.put(existing);
      const text = await resp.text().catch(() => "");
      throw new Error(`resolve_http_${resp.status}:${text}`);
    }
    const data = (await resp.json()) as ResolvePostResult & {
      resolvedAt?: string;
    };
    // Reconcile local cache with the server's canonical timestamp.
    if (data.resolvedAt) {
      await db.posts.put({
        ...existing,
        resolved_at: data.resolvedAt,
        resolved_helper_client_id: helperClientId,
      });
    }
    // Edge case: the asker and the helper are the same device (common in
    // demos when the presenter is logged in on one phone and thanks
    // themselves after a staged reply). Realtime will NOT fire for the
    // asker's own tab in that case because they initiated the update, so
    // we trigger the celebration overlay manually via a CustomEvent.
    // No-op in the common cross-device path because helperClientId won't
    // match the local clientId there.
    if (
      helperClientId &&
      helperClientId === authorClientId &&
      (data.pointsAwarded ?? 0) > 0 &&
      typeof window !== "undefined"
    ) {
      window.dispatchEvent(
        new CustomEvent("omnibridge:pointsAwarded", {
          detail: {
            delta: data.pointsAwarded ?? 0,
            helperName: state.user.name || null,
          },
        }),
      );
    }
    return {
      ok: data.ok ?? true,
      pointsAwarded: data.pointsAwarded ?? 0,
      helperPoints: data.helperPoints ?? null,
      alreadyResolved: data.alreadyResolved,
    };
  } catch (err) {
    console.warn("[posts] resolvePost failed:", err);
    throw err;
  }
}

/** Attempt to flush every queued post. */
export async function syncOutbox(): Promise<number> {
  if (!hasSupabase || !supabase || !effectiveOnline()) return 0;
  const queued = await db.outbox.toArray();
  let sent = 0;
  for (const item of queued) {
    try {
      const { error } = await supabase.from("posts").insert(item.post);
      if (error) throw error;
      await db.outbox.delete(item.id);
      sent += 1;
    } catch (err) {
      console.warn("[posts] outbox item failed:", item.id, err);
      await db.outbox.update(item.id, { attempts: item.attempts + 1 });
    }
  }
  return sent;
}
