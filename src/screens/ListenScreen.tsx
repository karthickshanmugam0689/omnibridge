import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowLeft,
  Keyboard,
  Loader2,
  Mic,
  MicOff,
  Search,
  Sparkles,
  Volume2,
  VolumeX,
} from "lucide-react";
import { db } from "@/lib/db";
import {
  filterRelevantHits,
  getEmbeddingStatus,
  keywordRank,
  semanticRank,
  subscribeEmbeddingStatus,
} from "@/lib/embeddings";
import { CATEGORY_EMOJI, type Post, type SourceLang } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";
import {
  localeToBcp47,
  speakSequence,
  startListening,
  stopSpeaking,
  voiceInputSupported,
  voiceOutputSupported,
  type VoiceSession,
} from "@/lib/voice";
import { cn, timeAgo } from "@/lib/utils";
import {
  earconStart,
  earconSuccess,
  earconError,
  earconSubmit,
} from "@/lib/earcons";
import { hapticTap, hapticSuccess, hapticError } from "@/lib/haptics";

type Phase = "idle" | "listening" | "thinking" | "match" | "empty";

// Keep parity with FeedScreen's offline cap so the flagship flow doesn't
// feel more generous than the feed search when the user is disconnected.
const OFFLINE_MAX_RESULTS = 3;

interface Localised {
  post: Post;
  title: string;
  body: string;
  translated: boolean;
}

function localisePost(post: Post, viewerLang: string): Localised {
  const lang = viewerLang as "sk" | "en" | "ar" | "uk";
  const title =
    lang === "sk"
      ? post.title_sk
      : post.title_translations?.[lang as "en" | "ar" | "uk"] ?? post.title_sk;
  const body =
    lang === "sk"
      ? post.body_sk ?? ""
      : post.body_translations?.[lang as "en" | "ar" | "uk"] ?? post.body_sk ?? "";
  const source = (post.source_lang ?? "sk") as SourceLang;
  return { post, title, body, translated: source !== (viewerLang as SourceLang) };
}

/**
 * Flagship voice-first "Ask out loud" mode.
 *
 * One giant mic, one gesture. Speak → transcribe → semantic-rank cached posts
 * on-device → read the best match back aloud in the viewer's language →
 * next/skip/accept. Degrades gracefully to a keyboard textarea when the
 * browser has no SpeechRecognition, and skips TTS when no voice is available.
 *
 * Deliberately reuses everything from FeedScreen's search pipeline so
 * results here can't drift from results there: same `semanticRank`,
 * `filterRelevantHits`, `keywordRank` fallback, same OFFLINE_MAX_RESULTS cap.
 */
export default function ListenScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const language = useAppStore((s) => s.language);
  const offline = useAppStore((s) => !s.online || s.offlineDemo);

  const [phase, setPhase] = useState<Phase>("idle");
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [matches, setMatches] = useState<Localised[]>([]);
  const [matchIndex, setMatchIndex] = useState(0);
  const [embedderReady, setEmbedderReady] = useState(
    getEmbeddingStatus().phase === "ready",
  );
  const [ttsActive, setTtsActive] = useState(false);
  const [keyboardMode, setKeyboardMode] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const voiceSessionRef = useRef<VoiceSession | null>(null);
  const speakHandleRef = useRef<{ cancel: () => void } | null>(null);
  const phaseRef = useRef<Phase>("idle");
  phaseRef.current = phase;
  // Mirror transcript/interim into refs so the recogniser's `onEnd` callback
  // — which closes over the values captured at the time we wired up
  // `startListening` — can always read the newest user input without relying
  // on stale closures or nested setState readers.
  const transcriptRef = useRef("");
  const interimRef = useRef("");
  transcriptRef.current = transcript;
  interimRef.current = interim;

  const posts = useLiveQuery(
    () => db.posts.orderBy("created_at").reverse().toArray(),
    [],
    [],
  );

  useEffect(() => subscribeEmbeddingStatus((s) => setEmbedderReady(s.phase === "ready")), []);

  const canListen = voiceInputSupported();
  const canSpeak = voiceOutputSupported();

  // Always stop any in-flight recogniser / TTS when we unmount so the user
  // can't get ambushed by audio after navigating away.
  useEffect(() => {
    return () => {
      voiceSessionRef.current?.stop();
      speakHandleRef.current?.cancel();
      stopSpeaking();
    };
  }, []);

  const playMatch = useCallback(
    (m: Localised) => {
      if (!canSpeak) return;
      speakHandleRef.current?.cancel();
      const lang = localeToBcp47(language);
      const author = m.post.author_name?.trim() || "";
      const intro = author
        ? `${t("listen.voiceIntro")} ${author}.`
        : t("listen.voiceIntro");
      setTtsActive(true);
      speakHandleRef.current = speakSequence([
        { text: intro, lang, rate: 0.95 },
        { text: m.title, lang, rate: 0.95 },
        {
          text: m.body,
          lang,
          rate: 0.95,
          onEnd: () => setTtsActive(false),
        },
      ]);
    },
    [canSpeak, language, t],
  );

  const runSearch = useCallback(
    async (query: string) => {
      const q = query.trim();
      if (!q) {
        setPhase("idle");
        return;
      }
      setPhase("thinking");
      setError(null);
      const pool = posts ?? [];
      try {
        let hits;
        if (embedderReady) {
          try {
            hits = await semanticRank(q, pool);
          } catch (err) {
            console.warn("[listen] semantic rank failed, falling back", err);
            hits = keywordRank(q, pool);
          }
        } else {
          hits = keywordRank(q, pool);
        }
        const cap = offline ? OFFLINE_MAX_RESULTS : undefined;
        let top = filterRelevantHits(hits, cap);
        if (top.length === 0) {
          const kw = keywordRank(q, pool).filter((h) => h.score > 0);
          top = offline ? kw.slice(0, OFFLINE_MAX_RESULTS) : kw;
        }
        const localised = top.map((h) => localisePost(h.post, language));
        if (localised.length === 0) {
          setMatches([]);
          setMatchIndex(0);
          setPhase("empty");
          // Non-verbal cues fire BEFORE the TTS announcement so users hear
          // "no match" before the voice starts reading the fallback copy.
          earconError();
          hapticError();
          if (canSpeak) {
            setTtsActive(true);
            speakHandleRef.current = speakSequence([
              {
                text: t("listen.noMatchSpoken"),
                lang: localeToBcp47(language),
                onEnd: () => setTtsActive(false),
              },
            ]);
          }
          return;
        }
        setMatches(localised);
        setMatchIndex(0);
        setPhase("match");
        // Cheerful earcon + short haptic BEFORE TTS kicks in so even users
        // with a long-winded answer know "we found something" instantly.
        earconSuccess();
        hapticSuccess();
        playMatch(localised[0]);
      } catch (err) {
        console.error("[listen] search failed", err);
        setError(t("listen.errorSearch"));
        earconError();
        hapticError();
        setPhase("idle");
      }
    },
    [posts, embedderReady, offline, language, canSpeak, t, playMatch],
  );

  const startListen = useCallback(() => {
    if (!canListen) {
      setKeyboardMode(true);
      return;
    }
    setError(null);
    setTranscript("");
    setInterim("");
    setPhase("listening");
    // Audible + tactile "we're listening" cue. Fires inside the user-gesture
    // call stack so the AudioContext unlocks even on iOS autoplay policies.
    earconStart();
    hapticTap();
    voiceSessionRef.current = startListening({
      lang: localeToBcp47(language),
      onTranscript: (text, isFinal) => {
        if (isFinal) {
          setTranscript(text);
          setInterim("");
        } else {
          setInterim(text);
        }
      },
      onError: (err) => {
        console.warn("[listen] recogniser error", err);
        voiceSessionRef.current = null;
        // `no-speech` / `aborted` are normal; treat as silent end and let the
        // user try again rather than firing a scary error toast.
        if (err !== "no-speech" && err !== "aborted") {
          setError(t("listen.errorVoice"));
          setKeyboardMode(true);
        }
        setPhase((p) => (p === "listening" ? "idle" : p));
      },
      onEnd: () => {
        voiceSessionRef.current = null;
        // Use the ref so we only act when the user hasn't already moved on
        // (e.g. they tapped the mic again or navigated away before the
        // recogniser finished finalising).
        if (phaseRef.current !== "listening") return;
        const final = (transcriptRef.current || interimRef.current).trim();
        setInterim("");
        if (final) {
          setTranscript(final);
          // "Got it, working on it" earcon bridges the silence between the
          // user finishing their question and the first TTS answer.
          earconSubmit();
          void runSearch(final);
        } else {
          setPhase("idle");
        }
      },
    });
    if (!voiceSessionRef.current) {
      // startListening returned null (no recogniser available after all).
      setKeyboardMode(true);
      setPhase("idle");
    }
  }, [canListen, language, runSearch, t]);

  const stopListen = useCallback(() => {
    voiceSessionRef.current?.stop();
    voiceSessionRef.current = null;
  }, []);

  const handleMicTap = () => {
    if (phase === "listening") {
      stopListen();
      return;
    }
    if (phase === "match" || phase === "empty") {
      speakHandleRef.current?.cancel();
      setTtsActive(false);
    }
    startListen();
  };

  const nextMatch = () => {
    speakHandleRef.current?.cancel();
    hapticTap();
    if (matchIndex + 1 >= matches.length) {
      // Wrap back round so the user can hear the top match again without fuss.
      setMatchIndex(0);
      playMatch(matches[0]);
      return;
    }
    const next = matchIndex + 1;
    setMatchIndex(next);
    playMatch(matches[next]);
  };

  const acceptMatch = () => {
    speakHandleRef.current?.cancel();
    stopSpeaking();
    const current = matches[matchIndex];
    if (!current) return;
    hapticTap();
    navigate(`/?post=${current.post.id}`);
  };

  const askCommunity = () => {
    speakHandleRef.current?.cancel();
    stopSpeaking();
    navigate("/new", { state: { prefill: { text: transcript } } });
  };

  const resetToIdle = () => {
    speakHandleRef.current?.cancel();
    stopSpeaking();
    setTtsActive(false);
    setMatches([]);
    setMatchIndex(0);
    setTranscript("");
    setInterim("");
    setPhase("idle");
  };

  const toggleTts = () => {
    if (ttsActive) {
      speakHandleRef.current?.cancel();
      stopSpeaking();
      setTtsActive(false);
      return;
    }
    const current = matches[matchIndex];
    if (current) playMatch(current);
  };

  const liveText = transcript || interim;
  const current = matches[matchIndex];

  return (
    <section className="space-y-6">
      <header className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label={t("common.back")}
          className="size-12 min-h-touch grid place-items-center rounded-full hover:bg-muted text-ink"
        >
          <ArrowLeft className="size-6" aria-hidden />
        </button>
        <h1 className="flex-1">{t("listen.screenTitle")}</h1>
      </header>

      <div
        className={cn(
          "card flex flex-col items-center gap-5 py-8",
          phase === "listening" && "bg-primary/5 border-primary/30 border-2",
        )}
      >
        <button
          type="button"
          onClick={handleMicTap}
          aria-pressed={phase === "listening"}
          aria-label={
            phase === "listening"
              ? t("listen.stop")
              : t("listen.tapToSpeak")
          }
          className={cn(
            "relative grid place-items-center rounded-full size-36 text-white shadow-soft-lg transition-transform motion-safe:active:scale-95",
            phase === "listening"
              ? "bg-primary motion-safe:animate-pulse"
              : "bg-primary",
          )}
        >
          {phase === "listening" ? (
            <MicOff className="size-14" aria-hidden />
          ) : (
            <Mic className="size-14" aria-hidden />
          )}
        </button>

        <p className="font-bold text-xl text-center">
          {phase === "listening"
            ? t("listen.listening")
            : phase === "thinking"
              ? t("listen.thinking")
              : t("listen.tapToSpeak")}
        </p>

        {phase !== "listening" && phase !== "thinking" && (
          <p className="text-base text-muted-foreground text-center max-w-md">
            {t("listen.instructions")}
          </p>
        )}

        {(phase === "listening" || liveText) && (
          <p
            role="status"
            aria-live="polite"
            className="w-full max-w-md rounded-2xl border border-border bg-white/60 px-4 py-3 text-base text-center text-ink min-h-[56px] flex items-center justify-center"
          >
            {liveText || t("listen.listeningHint")}
          </p>
        )}

        {phase === "thinking" && (
          <Loader2 className="size-7 text-primary motion-safe:animate-spin" aria-hidden />
        )}

        {!canListen && !keyboardMode && phase === "idle" && (
          <button
            type="button"
            onClick={() => setKeyboardMode(true)}
            className="inline-flex items-center gap-2 text-primary font-semibold underline underline-offset-4"
          >
            <Keyboard className="size-5" aria-hidden />
            {t("listen.useKeyboard")}
          </button>
        )}
      </div>

      {keyboardMode && (
        <div className="card space-y-3">
          <label htmlFor="listen-keyboard" className="block font-bold text-base">
            {t("listen.keyboardLabel")}
          </label>
          <textarea
            id="listen-keyboard"
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            lang={localeToBcp47(language)}
            rows={3}
            placeholder={t("listen.keyboardPlaceholder")}
            className="w-full rounded-2xl border border-border bg-white p-4 text-base focus-visible:ring-4 focus-visible:ring-primary/40 focus-visible:outline-none"
          />
          <button
            type="button"
            onClick={() => void runSearch(transcript)}
            disabled={!transcript.trim() || phase === "thinking"}
            className="btn-primary w-full text-lg"
          >
            <Search className="size-5" aria-hidden />
            {t("listen.searchNow")}
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="card bg-offline/10 border-2 border-offline/30 text-ink">
          {error}
        </p>
      )}

      {/*
        Persistent "you said: …" echo — gives low-vision users an unambiguous
        record of what the recogniser heard. We keep it visible across
        thinking/match/empty so the context stays on-screen while the answer
        is read aloud.
      */}
      {transcript && phase !== "listening" && phase !== "idle" && (
        <p
          className="rounded-2xl border border-border bg-white px-4 py-3 text-base"
          aria-live="polite"
        >
          <span className="font-semibold text-muted-foreground">
            {t("listen.youSaid")}{" "}
          </span>
          <span className="text-ink">{transcript}</span>
        </p>
      )}

      {phase === "match" && current && (
        <div className="card space-y-4 border-2 border-primary/40 bg-primary/5 motion-safe:animate-[toast-in_300ms_ease-out]">
          <div className="flex items-center gap-3">
            <span aria-hidden className="text-3xl">
              {CATEGORY_EMOJI[current.post.category]}
            </span>
            <div className="flex-1">
              <p className="text-sm text-muted-foreground">
                {t("listen.voiceIntro")}{" "}
                <span className="font-semibold text-ink">
                  {current.post.author_emoji ?? "🙂"}{" "}
                  {current.post.author_name?.trim() || t("feed.title")}
                </span>
                {" · "}
                {t("feed.ago", { time: timeAgo(current.post.created_at, language) })}
              </p>
            </div>
            {canSpeak && (
              <button
                type="button"
                onClick={toggleTts}
                aria-pressed={ttsActive}
                aria-label={ttsActive ? t("listen.mute") : t("listen.playAgain")}
                className="size-12 min-h-touch grid place-items-center rounded-full bg-white border border-border text-ink hover:bg-muted"
              >
                {ttsActive ? (
                  <VolumeX className="size-6" aria-hidden />
                ) : (
                  <Volume2 className="size-6" aria-hidden />
                )}
              </button>
            )}
          </div>

          <h2 className="text-xl font-bold leading-snug">{current.title}</h2>
          {current.body && (
            <p className="text-base leading-relaxed whitespace-pre-wrap">
              {current.body}
            </p>
          )}

          {current.translated && (
            <p className="chip bg-muted text-muted-foreground text-xs">
              {t("responses.translatedFrom", {
                lang: t(`languages.${current.post.source_lang ?? "sk"}`),
              })}
            </p>
          )}

          <p className="text-sm text-muted-foreground text-center">
            {t("listen.matchCounter", {
              index: matchIndex + 1,
              total: matches.length,
            })}
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={acceptMatch}
              className="btn-primary w-full text-lg"
            >
              <Sparkles className="size-5" aria-hidden />
              {t("listen.thisHelps")}
            </button>
            <button
              type="button"
              onClick={nextMatch}
              className="btn-ghost w-full text-lg"
              disabled={matches.length <= 1}
            >
              {t("listen.nextMatch")}
            </button>
          </div>

          <button
            type="button"
            onClick={askCommunity}
            className="w-full rounded-2xl border-2 border-dashed border-primary/30 px-4 py-3 text-base font-semibold text-primary hover:bg-primary/10"
          >
            {t("listen.askCommunityInstead")}
          </button>

          <button
            type="button"
            onClick={resetToIdle}
            className="w-full text-sm text-muted-foreground underline underline-offset-4"
          >
            {t("listen.skipAll")}
          </button>
        </div>
      )}

      {phase === "empty" && (
        <div className="card space-y-4 border-2 border-dashed border-primary/40 bg-primary/5">
          <h2 className="text-xl font-bold">{t("listen.noMatchTitle")}</h2>
          <p className="text-base text-muted-foreground">
            {t("listen.noMatchBody", { query: transcript })}
          </p>
          <button
            type="button"
            onClick={askCommunity}
            className="btn-primary w-full text-lg"
          >
            {t("listen.askCommunity")}
          </button>
          <button
            type="button"
            onClick={resetToIdle}
            className="w-full text-sm text-muted-foreground underline underline-offset-4"
          >
            {t("listen.tryAgain")}
          </button>
        </div>
      )}
    </section>
  );
}
