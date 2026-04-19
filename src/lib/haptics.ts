/**
 * Tiny wrapper around `navigator.vibrate` so callers don't have to feature-
 * detect on every use. All functions are no-ops when the API is missing
 * (iOS Safari, most desktops) so UI code stays clean.
 *
 * Patterns are intentionally understated — a vibration that's too long feels
 * like a buzz saw on older Android devices. 10–30ms taps give tactile
 * feedback without becoming annoying when used repeatedly.
 */

function canVibrate(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.vibrate === "function"
  );
}

/** Single short tap. Useful for "button registered" confirmations. */
export function hapticTap(): void {
  if (!canVibrate()) return;
  try {
    navigator.vibrate(12);
  } catch {
    // Some kiosk/PWA contexts throw if vibration is policy-disabled.
  }
}

/** Double tap. Used to say "success — we did the thing". */
export function hapticSuccess(): void {
  if (!canVibrate()) return;
  try {
    navigator.vibrate([18, 60, 18]);
  } catch {
    // Swallow — haptics are cosmetic.
  }
}

/** Longer, slightly uncomfortable buzz to say "something went wrong". */
export function hapticError(): void {
  if (!canVibrate()) return;
  try {
    navigator.vibrate([40, 60, 40, 60, 40]);
  } catch {
    // Swallow — haptics are cosmetic.
  }
}
