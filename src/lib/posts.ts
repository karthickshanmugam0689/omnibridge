import { db } from "./db";
import { supabase, hasSupabase } from "./supabase";
import { translatePost } from "./translate";
import type { Category, Post } from "./types";

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
  if (hasSupabase && supabase && navigator.onLine) {
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
  title_sk: string;
  body_sk?: string;
  location?: string;
  is_resource?: boolean;
}

/**
 * Create a post. Translates via Gemini (cached), inserts into Supabase when
 * online, otherwise queues into the Dexie outbox for later sync.
 * Always inserts into the local cache immediately so the UI updates at once.
 */
export async function createPost(input: CreatePostInput): Promise<{ post: Post; queued: boolean }> {
  const textToTranslate = [input.title_sk, input.body_sk].filter(Boolean).join(". ");
  const { translations } = await translatePost(textToTranslate);

  const body = input.body_sk ?? "";
  const bodyTranslations = body
    ? (await translatePost(body)).translations
    : null;

  const now = new Date().toISOString();
  const post: Post = {
    id: uuid(),
    author_name: input.author_name || null,
    author_emoji: input.author_emoji || null,
    category: input.category,
    title_sk: input.title_sk,
    title_translations: translations,
    body_sk: input.body_sk ?? null,
    body_translations: bodyTranslations,
    is_resource: input.is_resource ?? false,
    last_status: null,
    location: input.location ?? null,
    created_at: now,
  };

  await db.posts.put(post);

  if (hasSupabase && supabase && navigator.onLine) {
    try {
      const { error } = await supabase.from("posts").insert(post);
      if (error) throw error;
      return { post, queued: false };
    } catch (err) {
      console.warn("[posts] insert failed, queuing:", err);
    }
  }

  await db.outbox.put({
    id: post.id,
    post,
    queued_at: now,
    attempts: 0,
  });

  return { post, queued: true };
}

/** Attempt to flush every queued post. */
export async function syncOutbox(): Promise<number> {
  if (!hasSupabase || !supabase || !navigator.onLine) return 0;
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
