import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import confetti from "canvas-confetti";
import { PartyPopper, X } from "lucide-react";
import { supabase, hasSupabase } from "@/lib/supabase";
import { useAppStore } from "@/store/useAppStore";
import { earconSuccess } from "@/lib/earcons";
import { hapticSuccess } from "@/lib/haptics";

/**
 * Global "you just got thanked" overlay.
 *
 * Subscribes to Supabase realtime `UPDATE`s on the current user's row in
 * `profiles`. When `points` increases, we:
 *   1. Update the Zustand store so Settings/onboarding show the new total.
 *   2. Fire a confetti burst + earcon + haptic so the moment feels like a win.
 *   3. Surface a big, tappable "+N points" card at the top of the viewport
 *      with the thanking neighbour's name when available.
 *
 * Mounted once at the App root so the celebration works regardless of which
 * screen the helper is currently looking at — including deep links landed
 * from a push-notification tap. Tolerant of Supabase being unavailable
 * (local-only mode): in that branch this component is inert.
 *
 * Accessibility:
 *   - The overlay uses `role="status"` + `aria-live="assertive"` so screen
 *     readers announce the thank-you even when the user isn't looking at
 *     the screen.
 *   - Respects `prefers-reduced-motion`: we skip the confetti (which would
 *     be 50 moving elements) but still show the card + play the earcon.
 *   - Dismiss button is a 44×44 px target.
 */

interface Celebration {
  id: number;
  delta: number;
  helperName: string | null;
}

/** How long the celebration stays on screen before auto-dismissing. */
const AUTO_DISMISS_MS = 6000;

export default function PointsCelebration() {
  const { t } = useTranslation();
  const clientId = useAppStore((s) => s.user.clientId);
  const setPoints = useAppStore((s) => s.setPoints);
  const storePoints = useAppStore((s) => s.points);

  // Ref (not state) so the realtime handler always reads the freshest
  // "last-known-total" without re-subscribing on every points change.
  // Seeded from the store so we don't celebrate on cold-start reconciliation.
  const lastPointsRef = useRef<number>(storePoints);
  useEffect(() => {
    lastPointsRef.current = storePoints;
  }, [storePoints]);

  const [celebration, setCelebration] = useState<Celebration | null>(null);
  const dismissTimerRef = useRef<number | null>(null);

  // ── Supabase realtime subscription ────────────────────────────────────
  useEffect(() => {
    if (!hasSupabase || !supabase || !clientId) return;

    const channel = supabase
      .channel(`profile-points:${clientId}`)
      .on(
        // Typed loosely — the Supabase Realtime types are pretty wide and
        // we only read the one field we care about. This is the standard
        // shape documented at supabase.com/docs/guides/realtime/postgres-changes.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "postgres_changes" as any,
        {
          event: "UPDATE",
          schema: "public",
          table: "profiles",
          filter: `client_id=eq.${clientId}`,
        },
        (payload: { new?: { points?: number | null }; old?: { points?: number | null } }) => {
          const next = payload.new?.points ?? null;
          if (typeof next !== "number") return;
          const prev = lastPointsRef.current;
          lastPointsRef.current = next;
          // Sync the store so Settings re-renders with the authoritative value.
          setPoints(next);
          const delta = next - prev;
          // Only celebrate positive deltas. A -N or 0 delta means the DB was
          // reset or the initial sync echoed back an already-known value.
          if (delta <= 0) return;
          fireCelebration(delta, null);
        },
      )
      .subscribe();

    return () => {
      // Capture the client in a local so TS is happy after the early-return
      // narrowing above. Also guards against the (impossible-in-practice)
      // case where `supabase` is torn down between mount and unmount.
      const client = supabase;
      if (client) void client.removeChannel(channel);
    };
    // We intentionally don't depend on `setPoints` — it's stable from Zustand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  // ── Local trigger (same-device asker marks solved → helper on same device)
  // We also listen for a custom DOM event so a /api/resolve response that
  // awarded points to the CURRENT user can kick off the same celebration
  // without waiting on realtime propagation. This is rare (most of the time
  // asker and helper are different devices) but makes the demo deterministic.
  useEffect(() => {
    const handler = (event: Event) => {
      const { detail } = event as CustomEvent<{
        delta: number;
        helperName?: string | null;
      }>;
      if (!detail?.delta || detail.delta <= 0) return;
      fireCelebration(detail.delta, detail.helperName ?? null);
    };
    window.addEventListener("omnibridge:pointsAwarded", handler);
    return () => window.removeEventListener("omnibridge:pointsAwarded", handler);
  }, []);

  function fireCelebration(delta: number, helperName: string | null): void {
    const id = Date.now();
    setCelebration({ id, delta, helperName });
    // Replace any pending dismiss timer so a second thank-you inside the
    // 6-second window resets the countdown instead of snapping shut mid-read.
    if (dismissTimerRef.current) window.clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = window.setTimeout(() => {
      setCelebration(null);
      dismissTimerRef.current = null;
    }, AUTO_DISMISS_MS);

    // Non-visual feedback — critical for low-vision users who might miss
    // the confetti animation entirely.
    earconSuccess();
    hapticSuccess();

    const reduceMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduceMotion) {
      burstConfetti();
    }
  }

  const dismiss = () => {
    if (dismissTimerRef.current) {
      window.clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    setCelebration(null);
  };

  if (!celebration) return null;

  return (
    <div
      role="status"
      aria-live="assertive"
      className="fixed inset-x-0 top-4 z-[70] pointer-events-none flex justify-center px-4"
    >
      <div className="pointer-events-auto max-w-md w-full rounded-3xl border-2 border-amber-300 bg-gradient-to-br from-amber-50 via-white to-amber-100 shadow-2xl p-5 flex items-start gap-4 motion-safe:animate-[celebration-in_450ms_cubic-bezier(0.22,1,0.36,1)]">
        <div
          className="shrink-0 rounded-full size-14 grid place-items-center bg-amber-500 text-white shadow-md motion-safe:animate-[celebration-bounce_900ms_ease-out]"
          aria-hidden
        >
          <PartyPopper className="size-7" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-lg font-black text-amber-900 leading-tight">
            {t("celebration.title")}
          </p>
          <p className="text-base text-amber-900 mt-1">
            {celebration.helperName
              ? t("celebration.bodyNamed", {
                  name: celebration.helperName,
                  points: celebration.delta,
                })
              : t("celebration.bodyGeneric", { points: celebration.delta })}
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("celebration.close")}
          className="shrink-0 size-11 -m-1 grid place-items-center rounded-full text-amber-900 hover:bg-amber-200/60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/**
 * Confetti choreography: two short, off-angle bursts so the particles fan
 * across the viewport instead of coming out of a single cannon. Keeps total
 * particle count low (~80) so underpowered phones don't drop frames.
 */
function burstConfetti(): void {
  try {
    const commonOpts = {
      particleCount: 40,
      spread: 60,
      startVelocity: 35,
      gravity: 0.9,
      ticks: 180,
      // Amber + emerald + red — loosely aligned with the "solved" and
      // celebratory palette used elsewhere in the app.
      colors: ["#f59e0b", "#fbbf24", "#10b981", "#34d399", "#ef4444", "#ffffff"],
      zIndex: 80,
    };
    confetti({ ...commonOpts, angle: 60, origin: { x: 0.1, y: 0.35 } });
    window.setTimeout(() => {
      confetti({ ...commonOpts, angle: 120, origin: { x: 0.9, y: 0.35 } });
    }, 140);
  } catch {
    // canvas-confetti throws if document isn't ready — benign; the earcon
    // and card still fire so the user gets feedback.
  }
}
