import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Mic, MicOff, Loader2, Send, Sparkles, Siren } from "lucide-react";
import { CATEGORIES, CATEGORY_EMOJI, type Category } from "@/lib/types";
import { createPost } from "@/lib/posts";
import {
  startListening,
  voiceInputSupported,
  localeToBcp47,
  type VoiceSession,
} from "@/lib/voice";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";
import EnableNotificationsPrompt from "@/components/EnableNotificationsPrompt";
import { pushSupported } from "@/lib/push";
import ToastBanner from "@/components/ToastBanner";

interface PrefillState {
  prefill?: {
    text?: string;
    category?: Category;
  };
}

export default function NewPostScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const user = useAppStore((s) => s.user);
  const language = useAppStore((s) => s.language);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const notifPromptSeen = useAppStore((s) => s.notifPromptSeen);
  const setNotifPromptSeen = useAppStore((s) => s.setNotifPromptSeen);
  const prefill = (routerLocation.state as PrefillState | null)?.prefill;
  const [text, setText] = useState(prefill?.text ?? "");
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState<Category>(prefill?.category ?? "help");
  // Urgent is opt-in: we deliberately default to off so the author has to
  // make an explicit choice before spamming every volunteer's device.
  const [isUrgent, setIsUrgent] = useState(false);
  const [fromSearch] = useState(Boolean(prefill?.text));
  const [listening, setListening] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showNotifPrompt, setShowNotifPrompt] = useState(false);
  const sessionRef = useRef<VoiceSession | null>(null);

  // Clear the search query so returning to the feed after posting starts fresh,
  // and consume the router state so a page refresh doesn't re-apply the prefill.
  useEffect(() => {
    if (prefill?.text) {
      setSearchQuery("");
      navigate(routerLocation.pathname, { replace: true, state: null });
    }
    // Run once on mount; intentionally excluding navigate/routerLocation deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleVoice = () => {
    if (listening) {
      sessionRef.current?.stop();
      setListening(false);
      return;
    }
    if (!voiceInputSupported()) {
      setToast(t("new.errorVoice"));
      return;
    }
    setListening(true);
    sessionRef.current = startListening({
      lang: localeToBcp47(language),
      onTranscript: (transcript, isFinal) => {
        setText(transcript);
        if (isFinal) setListening(false);
      },
      onError: () => setListening(false),
      onEnd: () => setListening(false),
    });
  };

  const submit = async () => {
    const title = text.trim();
    if (!title || submitting) return;
    setSubmitting(true);
    try {
      const { queued } = await createPost({
        author_name: user.name || "Anonym",
        author_emoji: user.emoji,
        category,
        title,
        location: location || undefined,
        is_urgent: isUrgent,
      });
      setToast(queued ? t("new.queued") : t("new.success"));
      // First-post moment is the highest-intent time to ask about notifications.
      // After they've answered (yes/later/dismiss), we navigate home.
      const shouldAsk = !notifPromptSeen && pushSupported();
      if (shouldAsk) {
        setShowNotifPrompt(true);
      } else {
        setTimeout(() => navigate("/"), 800);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const dismissNotifPrompt = () => {
    setNotifPromptSeen(true);
    setShowNotifPrompt(false);
    navigate("/");
  };

  if (showNotifPrompt) {
    return (
      <section className="space-y-4">
        <h1>{t("new.successHeading")}</h1>
        <EnableNotificationsPrompt onDone={dismissNotifPrompt} />
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <h1>{t("new.title")}</h1>

      {fromSearch && (
        <p
          className="chip bg-primary/10 text-primary border border-primary/20"
          role="status"
        >
          <Sparkles className="size-4" aria-hidden />
          {t("new.fromSearchHint")}
        </p>
      )}

      <div className="card flex flex-col items-center gap-4">
        <button
          type="button"
          onClick={toggleVoice}
          className={cn(
            "relative rounded-full size-24 grid place-items-center text-white shadow-soft-lg transition-transform motion-safe:active:scale-95",
            listening ? "bg-primary motion-safe:animate-pulse" : "bg-primary",
          )}
          aria-label={listening ? t("new.stopRecording") : t("new.tapToSpeak")}
          aria-pressed={listening}
        >
          {listening ? (
            <MicOff className="size-10" aria-hidden />
          ) : (
            <Mic className="size-10" aria-hidden />
          )}
        </button>
        <p className="font-bold">
          {listening ? t("new.listening") : t("new.tapToSpeak")}
        </p>
        <p className="text-sm text-muted-foreground">{t("new.orType")}</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("new.placeholder")}
          lang={localeToBcp47(language)}
          rows={3}
          className="w-full rounded-2xl border border-border bg-white p-4 text-base min-h-[120px] focus-visible:ring-4 focus-visible:ring-primary/40 focus-visible:outline-none"
        />
        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder={t("new.location")}
          className="w-full rounded-2xl border border-border bg-white p-4 text-base focus-visible:ring-4 focus-visible:ring-primary/40 focus-visible:outline-none"
        />
      </div>

      <div>
        <p className="font-bold mb-3">{t("new.chooseCategory")}</p>
        <div className="grid grid-cols-4 gap-3">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              aria-pressed={category === c}
              className={cn(
                "card flex flex-col items-center gap-1 py-4 min-h-touch",
                category === c && "ring-4 ring-primary/60 bg-primary/5",
              )}
            >
              <span className="text-3xl" aria-hidden>
                {CATEGORY_EMOJI[c]}
              </span>
              <span className="text-sm font-bold">{t(`categories.${c}`)}</span>
            </button>
          ))}
        </div>
      </div>

      {/*
        Urgent toggle. Full-width button (not a checkbox) because (a) it
        needs to read as a serious choice, not a throwaway tickbox, and
        (b) a 56-px tap target is friendlier for elderly fingers than a
        20-px checkbox. Ring + red fill on when active so a one-second
        glance tells you "this is the loud one".
      */}
      <div>
        <p className="font-bold mb-3">{t("new.urgencyHeading")}</p>
        <button
          type="button"
          onClick={() => setIsUrgent((v) => !v)}
          aria-pressed={isUrgent}
          className={cn(
            "w-full rounded-2xl border-2 px-4 py-4 min-h-touch flex items-start gap-3 text-left transition-colors motion-safe:active:scale-[0.99]",
            isUrgent
              ? "border-red-500 bg-red-50 text-red-900 shadow-sm"
              : "border-border bg-white hover:bg-muted/30",
          )}
        >
          <span
            className={cn(
              "shrink-0 rounded-full size-10 grid place-items-center",
              isUrgent ? "bg-red-500 text-white" : "bg-muted text-muted-foreground",
            )}
            aria-hidden
          >
            <Siren className="size-5" />
          </span>
          <span className="flex-1">
            <span className="block font-bold text-base">
              {isUrgent ? t("new.urgencyOn") : t("new.urgencyOff")}
            </span>
            <span className="block text-sm opacity-80 mt-0.5">
              {isUrgent ? t("new.urgencyOnHint") : t("new.urgencyOffHint")}
            </span>
          </span>
        </button>
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={!text.trim() || submitting}
        className="btn-primary w-full text-lg"
      >
        {submitting ? (
          <>
            <Loader2 className="size-5 motion-safe:animate-spin" aria-hidden />
            {t("new.translating")}
          </>
        ) : (
          <>
            <Send className="size-5" aria-hidden />
            {t("new.submit")}
          </>
        )}
      </button>

      {toast && (
        <ToastBanner
          message={toast}
          variant="success"
          onClose={() => setToast(null)}
        />
      )}
    </section>
  );
}
