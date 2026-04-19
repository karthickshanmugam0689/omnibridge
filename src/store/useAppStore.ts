import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Language } from "@/i18n";
import type { Availability, Category } from "@/lib/types";

export interface UserProfile {
  name: string;
  emoji: string;
  /**
   * Anonymous, stable per-device identifier. Generated on first launch and
   * persisted forever (via the Zustand `persist` middleware). Used to:
   *   - tag posts with their author's device, so we can route push
   *     notifications to the correct subscribers when neighbours reply.
   *   - filter out the user's own replies from "new reply" notifications.
   * Never contains PII.
   */
  clientId: string;
}

/**
 * "Can you help your neighbours sometimes?" A user who opts in picks a set
 * of categories they can help with (`helperTags`) and a weekly `availability`
 * grid. The match engine at `/api/match` reads these when a new post lands
 * and sends a targeted push to the best-fitting volunteers.
 *
 * All fields are optional so a user who skips the onboarding step 2 simply
 * doesn't appear in match queries.
 */
export interface HelperPrefs {
  helperEnabled: boolean;
  helperTags: Category[];
  availability: Availability;
}

interface AppState {
  language: Language;
  setLanguage: (lng: Language) => void;
  user: UserProfile;
  setUser: (u: Partial<UserProfile>) => void;
  online: boolean;
  setOnline: (v: boolean) => void;
  lastSyncedAt: number | null;
  setLastSyncedAt: (t: number) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  /** User toggle: pretend we're offline for demo purposes, even if the browser thinks we're online. */
  offlineDemo: boolean;
  setOfflineDemo: (v: boolean) => void;
  /** Has the post-create push permission prompt already been shown / answered? */
  notifPromptSeen: boolean;
  setNotifPromptSeen: (v: boolean) => void;
  /**
   * Font-size scale applied to the `<html>` element (via the `--app-font-scale`
   * CSS custom property in `index.css`). "md" is the default 18 px base; "lg"
   * and "xl" are one-tap bigger steps for users with reduced vision or
   * arthritis that make precise taps on small text difficult.
   */
  fontScale: FontScale;
  setFontScale: (v: FontScale) => void;
  /** Volunteer-matching preferences. See `HelperPrefs`. */
  helper: HelperPrefs;
  setHelper: (patch: Partial<HelperPrefs>) => void;
  /**
   * Has the user been shown / dismissed the step-2 "can you help your
   * neighbours?" onboarding card? Decoupled from actually enabling help so
   * someone can skip the card now and opt in later from Settings without
   * the card ever reappearing.
   */
  helperOnboarded: boolean;
  setHelperOnboarded: (v: boolean) => void;
  /**
   * Ephemeral per-post match outcome. Populated after `/api/match` returns
   * so the post author sees a "N helpers alerted" chip on the card they
   * just posted, without waiting for Supabase realtime or a manual refresh.
   * Not persisted — freshness matters more than durability here.
   */
  matchStats: Record<
    string,
    {
      alerted: number;
      candidates: number;
      /**
       * Optional server-side reason when 0 helpers were alerted, e.g.
       * "outside_hours" or "no_helpers_opted_in_for_category". Lets the
       * author's UI explain why the bell didn't ring instead of leaving
       * them guessing.
       */
      skipped?: string;
      profilesChecked?: number;
    }
  >;
  setMatchStats: (
    postId: string,
    stats: {
      alerted: number;
      candidates: number;
      skipped?: string;
      profilesChecked?: number;
    },
  ) => void;
  /**
   * Server-owned thank-you points total. Refreshed from Supabase after
   * login and whenever `/api/resolve` returns a delta; we persist it only
   * so Settings can render something on cold offline starts.
   */
  points: number;
  setPoints: (points: number) => void;
}

export type FontScale = "md" | "lg" | "xl";

/** Multipliers applied to the 18 px base — kept in sync with `:root` CSS. */
export const FONT_SCALE_VALUE: Record<FontScale, number> = {
  md: 1,
  lg: 1.15,
  xl: 1.3,
};

const DEFAULT_EMOJIS = ["🌻", "🐻", "🦉", "🦊", "🌳", "⭐", "🫖", "🐝"];
const randomEmoji = () =>
  DEFAULT_EMOJIS[Math.floor(Math.random() * DEFAULT_EMOJIS.length)];

function newClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for ancient browsers — good enough for an anonymous device id.
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      language: "en",
      setLanguage: (language) => set({ language }),
      user: { name: "", emoji: randomEmoji(), clientId: newClientId() },
      setUser: (u) => set((s) => ({ user: { ...s.user, ...u } })),
      online: typeof navigator !== "undefined" ? navigator.onLine : true,
      setOnline: (online) => set({ online }),
      lastSyncedAt: null,
      setLastSyncedAt: (lastSyncedAt) => set({ lastSyncedAt }),
      searchQuery: "",
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      offlineDemo: false,
      setOfflineDemo: (offlineDemo) => set({ offlineDemo }),
      notifPromptSeen: false,
      setNotifPromptSeen: (notifPromptSeen) => set({ notifPromptSeen }),
      fontScale: "md",
      setFontScale: (fontScale) => set({ fontScale }),
      helper: {
        helperEnabled: false,
        helperTags: [],
        availability: {},
      },
      setHelper: (patch) =>
        set((s) => ({ helper: { ...s.helper, ...patch } })),
      helperOnboarded: false,
      setHelperOnboarded: (helperOnboarded) => set({ helperOnboarded }),
      matchStats: {},
      setMatchStats: (postId, stats) =>
        set((s) => ({ matchStats: { ...s.matchStats, [postId]: stats } })),
      points: 0,
      setPoints: (points) => set({ points }),
    }),
    {
      name: "omnibridge.app",
      version: 4,
      partialize: (s) => ({
        language: s.language,
        user: s.user,
        lastSyncedAt: s.lastSyncedAt,
        offlineDemo: s.offlineDemo,
        notifPromptSeen: s.notifPromptSeen,
        fontScale: s.fontScale,
        helper: s.helper,
        helperOnboarded: s.helperOnboarded,
        // Persist points so Settings can show a non-zero number on cold
        // offline start. Authoritative value still comes from Supabase.
        points: s.points,
      }),
      migrate: (persisted, _from): AppState => {
        // v1 had no clientId — backfill one now so existing visitors stay
        // recognisable across page loads instead of getting a fresh anon id.
        // v3 adds helper profile defaults for users who persisted before the
        // volunteer matching feature landed.
        // v4 adds `points` (server-owned thank-you counter).
        const p = (persisted ?? {}) as Partial<AppState>;
        const user = p.user ?? { name: "", emoji: randomEmoji(), clientId: "" };
        if (!user.clientId) user.clientId = newClientId();
        const helper = p.helper ?? {
          helperEnabled: false,
          helperTags: [],
          availability: {},
        };
        const helperOnboarded = p.helperOnboarded ?? false;
        const points = typeof p.points === "number" ? p.points : 0;
        return {
          ...(p as AppState),
          user,
          helper,
          helperOnboarded,
          points,
        };
      },
    },
  ),
);
