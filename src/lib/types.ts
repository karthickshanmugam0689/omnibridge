export type Category =
  | "help"
  | "food"
  | "medical"
  | "ride"
  | "legal"
  | "resource"
  | "tech"
  | "other";

export const CATEGORIES: Category[] = [
  "help",
  "food",
  "medical",
  "ride",
  "legal",
  "resource",
  "tech",
  "other",
];

export const CATEGORY_EMOJI: Record<Category, string> = {
  help: "📦",
  food: "🍎",
  medical: "🏥",
  ride: "🚗",
  legal: "⚖️",
  resource: "🌐",
  tech: "🔧",
  other: "💬",
};

/**
 * A set of per-language strings. `sk` is included so the type is symmetric
 * across all four supported languages; on Posts it's usually omitted because
 * the canonical Slovak text lives in `title_sk` / `body_sk` for indexing.
 * On Responses (`message_translations`) all four keys are populated.
 */
export interface Translations {
  sk?: string;
  en?: string;
  ar?: string;
  uk?: string;
}

export type SourceLang = "sk" | "en" | "ar" | "uk";

export interface Post {
  id: string;
  author_name: string | null;
  author_emoji: string | null;
  /**
   * Stable anonymous device id of the post's author. Used to route push
   * notifications back to them when neighbours reply. Optional so older
   * cached/seeded posts (created before this column existed) still load.
   */
  author_client_id?: string | null;
  /**
   * Language the author originally wrote this post in. We store translations
   * for every other language, but this flag lets consumers (search, push
   * notifications, "originally posted in X" UI hints) know which field is
   * the untouched original. Defaults to `"sk"` for legacy rows.
   */
  source_lang?: SourceLang | null;
  category: Category;
  title_sk: string;
  title_translations: Translations | null;
  body_sk: string | null;
  body_translations: Translations | null;
  is_resource: boolean;
  /**
   * Asker-flagged emergency broadcast. When true, `/api/match` ignores the
   * helper availability grid (everyone who opted in for the category is
   * pinged regardless of "free now") and the push title is prefixed with
   * "🚨 Urgent". The feed card also renders with a red halo. Optional so
   * older/seeded rows that predate the column continue to parse.
   */
  is_urgent?: boolean | null;
  last_status: string | null;
  location: string | null;
  /**
   * Set by the post author when they mark the request as solved. Clients
   * use this to hide the "Yes, I can help" button, lock the thread composer,
   * and render a green "Solved" chip in the feed.
   */
  resolved_at?: string | null;
  /**
   * `client_id` of the helper the author chose to thank. May be null even
   * when `resolved_at` is set (author solved it themselves, or skipped
   * picking a helper). `/api/resolve` awards points to this helper.
   */
  resolved_helper_client_id?: string | null;
  created_at: string;
}

export interface OutboxItem {
  id: string;
  post: Omit<Post, "id" | "created_at"> & {
    id?: string;
    created_at?: string;
  };
  queued_at: string;
  attempts: number;
}

/**
 * A reply to a Post. Many-to-one: a post can have any number of responses.
 * `author_client_id` is the responder's anonymous device id — used to filter
 * "I replied to my own post" out of notifications and to render an "it's you"
 * marker beside their replies.
 */
export interface Response {
  id: string;
  post_id: string;
  author_client_id: string;
  author_name: string | null;
  author_emoji: string | null;
  /** Original message as the author typed it. */
  message: string;
  /** Language the author wrote the message in. Defaults to `"sk"` if absent. */
  source_lang?: SourceLang | null;
  /**
   * Translations for every supported language, including the source (which
   * is usually the same string as `message`). Lets every viewer see the
   * reply in their own chosen UI language without server round-trips.
   */
  message_translations?: Translations | null;
  /**
   * One-tap "Yes, I can help" offer. Rendered with a gold accent card and a
   * "Send private message" CTA on the author side.
   */
  is_offer?: boolean | null;
  /**
   * True for follow-up replies after an offer is accepted. Filtered out of
   * the thread unless the viewer's clientId is in `visible_to` — so only
   * the asker and the accepted helper see them.
   */
  is_private?: boolean | null;
  /** ClientIds allowed to see this reply. Null for public replies. */
  visible_to?: string[] | null;
  created_at: string;
}

/** Outbox row for a Response that couldn't be sent yet (offline / Supabase down). */
export interface ResponseOutboxItem {
  id: string;
  response: Response;
  queued_at: string;
  attempts: number;
}

// ── Helper profile (volunteer matching) ────────────────────────────────────
/** Short day-of-week keys, matching the grid row headings. */
export type Day = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export const DAYS: Day[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/**
 * Three coarse buckets that are easy to tap and easy to match against "now"
 * without needing a timezone-aware scheduler. Morning 05:00-12:00, Afternoon
 * 12:00-17:00, Evening 17:00-23:00. Anything between 23:00-05:00 = no match.
 */
export type Bucket = "morning" | "afternoon" | "evening";
export const BUCKETS: Bucket[] = ["morning", "afternoon", "evening"];

/** Availability shape: `{ mon: ["morning"], tue: ["morning","afternoon"], ... }` */
export type Availability = Partial<Record<Day, Bucket[]>>;

/**
 * A neighbour who has opted in to help with specific categories at specific
 * times. The match engine looks this up on every new post. PII-free: only
 * the anonymous `client_id` links back to a device, plus a first name and an
 * emoji so the asker sees "Jana 🌳 is ready to help" rather than "Anonymous
 * device 5f4e3".
 */
export interface HelperProfile {
  client_id: string;
  name: string | null;
  emoji: string | null;
  preferred_lang: SourceLang | null;
  helper_tags: Category[];
  availability: Availability;
  helper_enabled: boolean;
  /**
   * Cumulative thank-you points. Owned by the server (`/api/resolve`
   * increments it when an asker credits this helper). Clients only read
   * this value back — never write — to avoid optimistic-local races
   * double-counting a thank-you.
   */
  points?: number;
  updated_at?: string;
}
