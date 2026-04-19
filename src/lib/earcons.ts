/**
 * Earcons — tiny non-verbal audio cues for state transitions.
 *
 * These aren't musical; they're short, distinct, and designed to NOT overlap
 * with speech synthesis. Used by `ListenScreen` so blind / low-vision users
 * get an acoustic confirmation of "listening started", "submission succeeded",
 * and "error" without waiting on the TTS engine to finish speaking.
 *
 * Implementation notes:
 *   - WebAudio is created lazily on first use. Autoplay policies require a
 *     user gesture to unlock audio, which the "Ask Out Loud" button provides.
 *   - We keep one AudioContext alive for the session to avoid the cost of
 *     spinning one up per cue (and the weird audible "tic" some browsers make).
 *   - When WebAudio is missing (old Safari) every function becomes a no-op;
 *     callers never need to handle that branch themselves.
 */

let ctx: AudioContext | null = null;
type ResumableContext = AudioContext & { resume?: () => Promise<void> };

function ensureContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  const rc = ctx as ResumableContext;
  if (rc.state === "suspended" && typeof rc.resume === "function") {
    // No-await: resuming is best-effort. If it fails (e.g. no user gesture
    // yet) the `beep` below will throw and we'll swallow it.
    void rc.resume();
  }
  return ctx;
}

/** Play a sine tone. Durations in seconds, frequency in Hz. */
function beep(freq: number, durationSec: number, volume = 0.08): void {
  const audio = ensureContext();
  if (!audio) return;
  try {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    // Short fade-in/fade-out stops the tone sounding like a "click".
    const now = audio.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.02);
    gain.gain.linearRampToValueAtTime(0, now + durationSec);
    osc.connect(gain).connect(audio.destination);
    osc.start(now);
    osc.stop(now + durationSec + 0.02);
  } catch {
    // Browsers can throw `InvalidStateError` if ctx isn't resumed yet.
    // Cue is cosmetic — swallow and move on.
  }
}

/** Rising two-tone: "we're listening now". */
export function earconStart(): void {
  beep(660, 0.12);
  window.setTimeout(() => beep(880, 0.12), 120);
}

/** Short single tone: "got it, we're working on it". */
export function earconSubmit(): void {
  beep(880, 0.1);
}

/** Bright two-tone: "success, here's an answer". */
export function earconSuccess(): void {
  beep(880, 0.1);
  window.setTimeout(() => beep(1320, 0.14), 100);
}

/** Low descending: "something went wrong". */
export function earconError(): void {
  beep(330, 0.16, 0.12);
  window.setTimeout(() => beep(220, 0.22, 0.12), 140);
}
