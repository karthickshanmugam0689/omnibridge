import { supabase, hasSupabase } from "./supabase";
import { useAppStore } from "@/store/useAppStore";
import type { HelperProfile } from "./types";

/**
 * Helper-profile sync.
 *
 * The client owns the source of truth in Zustand (persisted to localStorage)
 * so the app works offline and survives Supabase being down. When online, we
 * upsert the profile to `profiles` so `/api/match` can query for volunteers
 * on any new post. Writes are fire-and-forget: a failed upsert never breaks
 * the UI — the next successful save will re-send.
 *
 * The anonymous `client_id` is the primary key, matching the same id we tag
 * posts/responses with. No PII crosses the network beyond the first name,
 * chosen emoji and preferred language.
 */

function effectiveOnline(): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return false;
  return !useAppStore.getState().offlineDemo;
}

/** Build the full `HelperProfile` row from the current store state. */
export function buildProfileRow(): HelperProfile {
  const s = useAppStore.getState();
  return {
    client_id: s.user.clientId,
    name: s.user.name || null,
    emoji: s.user.emoji || null,
    preferred_lang: s.language,
    helper_tags: s.helper.helperTags,
    availability: s.helper.availability,
    helper_enabled: s.helper.helperEnabled,
    updated_at: new Date().toISOString(),
  };
}

/** Best-effort upsert. Returns true if Supabase accepted the write. */
export async function syncProfile(): Promise<boolean> {
  if (!hasSupabase || !supabase) return false;
  if (!effectiveOnline()) return false;
  const row = buildProfileRow();
  if (!row.client_id) return false;
  try {
    const { error } = await supabase
      .from("profiles")
      .upsert(row, { onConflict: "client_id" });
    if (error) {
      console.warn("[profile] upsert failed:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[profile] upsert threw:", err);
    return false;
  }
}

/**
 * Pull the server-authoritative `points` value into the store. Called on
 * app boot and after `/api/resolve` so the Settings screen always shows a
 * fresh total without waiting for a realtime notification. Silently no-ops
 * when offline or Supabase isn't configured — the persisted local value
 * remains the best-available display.
 */
export async function pullProfilePoints(): Promise<number | null> {
  if (!hasSupabase || !supabase) return null;
  if (!effectiveOnline()) return null;
  const clientId = useAppStore.getState().user.clientId;
  if (!clientId) return null;
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("points")
      .eq("client_id", clientId)
      .maybeSingle();
    if (error) {
      console.warn("[profile] points fetch failed:", error);
      return null;
    }
    const points = (data as { points?: number | null } | null)?.points ?? 0;
    useAppStore.getState().setPoints(points);
    return points;
  } catch (err) {
    console.warn("[profile] points fetch threw:", err);
    return null;
  }
}

/**
 * Delete the helper profile (used when a user turns off "available to help"
 * AND wants to be forgotten by the server). We keep it simple: disabling is
 * a flag on the row, not a delete, so the match engine just skips them.
 * Exposed for completeness in case a "delete my data" button is ever added.
 */
export async function deleteProfile(): Promise<boolean> {
  if (!hasSupabase || !supabase) return false;
  if (!effectiveOnline()) return false;
  const clientId = useAppStore.getState().user.clientId;
  if (!clientId) return false;
  try {
    const { error } = await supabase
      .from("profiles")
      .delete()
      .eq("client_id", clientId);
    if (error) {
      console.warn("[profile] delete failed:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[profile] delete threw:", err);
    return false;
  }
}

/**
 * Wire a store subscription that upserts the profile whenever one of its
 * inputs changes. Debounced so rapid chip-tapping in the onboarding grid
 * doesn't flood Supabase. Safe to call multiple times — the internal `wired`
 * flag makes it idempotent.
 */
let wired = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastSnapshot = "";
export function wireProfileSync() {
  if (wired) return;
  wired = true;

  const schedule = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void syncProfile();
    }, 1200);
  };

  // Snapshot only the fields that matter for the profile row. Any change
  // to name, emoji, language or helper prefs kicks off a debounced sync.
  const snap = () => {
    const s = useAppStore.getState();
    return JSON.stringify([
      s.user.clientId,
      s.user.name,
      s.user.emoji,
      s.language,
      s.helper.helperEnabled,
      s.helper.helperTags,
      s.helper.availability,
    ]);
  };

  lastSnapshot = snap();
  useAppStore.subscribe((state) => {
    void state;
    const next = snap();
    if (next !== lastSnapshot) {
      lastSnapshot = next;
      schedule();
    }
  });
}
