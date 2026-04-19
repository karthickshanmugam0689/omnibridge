import Dexie, { type EntityTable } from "dexie";
import type { OutboxItem, Post, Response, ResponseOutboxItem } from "./types";

export interface CachedTranslation {
  key: string;
  sourceLang: string;
  text: string;
  translations: { en?: string; ar?: string; uk?: string };
  suggestedCategory?: string;
  cached_at: string;
}

/**
 * A per-post embedding index for offline semantic search. We concatenate all
 * available language variants of a post into a single string and store one
 * vector per post — cross-lingual retrieval comes for free because the
 * upstream multilingual model shares embedding space across languages.
 */
export interface StoredEmbedding {
  postId: string;
  vector: number[];
  textHash: string;
  updatedAt: string;
}

export class OmniDB extends Dexie {
  posts!: EntityTable<Post, "id">;
  outbox!: EntityTable<OutboxItem, "id">;
  translations!: EntityTable<CachedTranslation, "key">;
  embeddings!: EntityTable<StoredEmbedding, "postId">;
  responses!: EntityTable<Response, "id">;
  responseOutbox!: EntityTable<ResponseOutboxItem, "id">;

  constructor() {
    super("omnibridge");
    this.version(1).stores({
      posts: "id, category, created_at, is_resource",
      outbox: "id, queued_at",
      translations: "key, cached_at",
    });
    this.version(2).stores({
      posts: "id, category, created_at, is_resource",
      outbox: "id, queued_at",
      translations: "key, cached_at",
      embeddings: "postId, updatedAt",
    });
    // v3 adds responses + responseOutbox. The compound index on
    // (post_id, created_at) lets us load a post's thread in time order
    // without a full table scan.
    this.version(3).stores({
      posts: "id, category, created_at, is_resource",
      outbox: "id, queued_at",
      translations: "key, cached_at",
      embeddings: "postId, updatedAt",
      responses: "id, post_id, created_at, [post_id+created_at]",
      responseOutbox: "id, queued_at",
    });
  }
}

export const db = new OmniDB();
