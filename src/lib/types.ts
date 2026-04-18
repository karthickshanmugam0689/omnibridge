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

export interface Translations {
  en?: string;
  ar?: string;
  uk?: string;
}

export interface Post {
  id: string;
  author_name: string | null;
  author_emoji: string | null;
  category: Category;
  title_sk: string;
  title_translations: Translations | null;
  body_sk: string | null;
  body_translations: Translations | null;
  is_resource: boolean;
  last_status: string | null;
  location: string | null;
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
