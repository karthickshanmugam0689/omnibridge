import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Language } from "@/i18n";

export interface UserProfile {
  name: string;
  emoji: string;
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
}

const DEFAULT_EMOJIS = ["🌻", "🐻", "🦉", "🦊", "🌳", "⭐", "🫖", "🐝"];
const randomEmoji = () =>
  DEFAULT_EMOJIS[Math.floor(Math.random() * DEFAULT_EMOJIS.length)];

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      language: "sk",
      setLanguage: (language) => set({ language }),
      user: { name: "", emoji: randomEmoji() },
      setUser: (u) => set((s) => ({ user: { ...s.user, ...u } })),
      online: typeof navigator !== "undefined" ? navigator.onLine : true,
      setOnline: (online) => set({ online }),
      lastSyncedAt: null,
      setLastSyncedAt: (lastSyncedAt) => set({ lastSyncedAt }),
    }),
    { name: "omnibridge.app" },
  ),
);
