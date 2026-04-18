import Dexie, { type EntityTable } from "dexie";
import type { OutboxItem, Post } from "./types";

export interface CachedTranslation {
  key: string;
  sourceLang: string;
  text: string;
  translations: { en?: string; ar?: string; uk?: string };
  suggestedCategory?: string;
  cached_at: string;
}

export class OmniDB extends Dexie {
  posts!: EntityTable<Post, "id">;
  outbox!: EntityTable<OutboxItem, "id">;
  translations!: EntityTable<CachedTranslation, "key">;

  constructor() {
    super("omnibridge");
    this.version(1).stores({
      posts: "id, category, created_at, is_resource",
      outbox: "id, queued_at",
      translations: "key, cached_at",
    });
  }
}

export const db = new OmniDB();
