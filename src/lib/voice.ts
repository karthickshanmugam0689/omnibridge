/**
 * Thin wrappers over the Web Speech API (SpeechRecognition + SpeechSynthesis).
 * Both APIs are browser-native and have no network dependency in most
 * browsers (Chrome/Edge send audio to Google, Safari runs on-device).
 */

type SpeechRecognitionInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult:
    | ((ev: { results: { [i: number]: { [j: number]: { transcript: string } } }; resultIndex: number }) => void)
    | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
};

interface WindowWithSpeech extends Window {
  SpeechRecognition?: new () => SpeechRecognitionInstance;
  webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
}

function getRecognitionCtor() {
  if (typeof window === "undefined") return null;
  const w = window as WindowWithSpeech;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const voiceInputSupported = () => getRecognitionCtor() !== null;

export const voiceOutputSupported = () =>
  typeof window !== "undefined" && "speechSynthesis" in window;

export interface VoiceSession {
  stop: () => void;
}

export interface StartListeningOptions {
  lang?: string;
  onTranscript: (transcript: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
  onEnd?: () => void;
}

export function startListening(opts: StartListeningOptions): VoiceSession | null {
  const Ctor = getRecognitionCtor();
  if (!Ctor) return null;

  const rec = new Ctor();
  rec.lang = opts.lang ?? "sk-SK";
  rec.continuous = false;
  rec.interimResults = true;

  rec.onresult = (ev) => {
    let transcript = "";
    let isFinal = false;
    const results = ev.results as unknown as ArrayLike<{
      0: { transcript: string };
      isFinal: boolean;
    }>;
    for (let i = ev.resultIndex; i < (results as { length: number }).length; i++) {
      const r = results[i];
      transcript += r[0].transcript;
      if (r.isFinal) isFinal = true;
    }
    opts.onTranscript(transcript, isFinal);
  };
  rec.onerror = (ev) => opts.onError?.(ev.error);
  rec.onend = () => opts.onEnd?.();

  try {
    rec.start();
  } catch (err) {
    opts.onError?.(String(err));
    return null;
  }

  return { stop: () => rec.stop() };
}

export interface SpeakOptions {
  text: string;
  lang?: string;
  rate?: number;
  onEnd?: () => void;
}

export function speak({ text, lang = "sk-SK", rate = 0.95, onEnd }: SpeakOptions) {
  if (!voiceOutputSupported() || !text) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = lang;
  utter.rate = rate;
  if (onEnd) utter.onend = onEnd;
  window.speechSynthesis.speak(utter);
}

export function stopSpeaking() {
  if (voiceOutputSupported()) window.speechSynthesis.cancel();
}

export function localeToBcp47(language: string): string {
  switch (language) {
    case "sk":
      return "sk-SK";
    case "en":
      return "en-US";
    case "ar":
      return "ar-SA";
    case "uk":
      return "uk-UA";
    default:
      return "sk-SK";
  }
}
