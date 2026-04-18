import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Mic, MicOff, Loader2, Send } from "lucide-react";
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

export default function NewPostScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAppStore((s) => s.user);
  const [text, setText] = useState("");
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState<Category>("help");
  const [listening, setListening] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const sessionRef = useRef<VoiceSession | null>(null);

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
      lang: "sk-SK",
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
        title_sk: title,
        location: location || undefined,
      });
      setToast(queued ? t("new.queued") : t("new.success"));
      setTimeout(() => navigate("/"), 800);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="space-y-6">
      <h1>{t("new.title")}</h1>

      <div className="card flex flex-col items-center gap-4">
        <button
          type="button"
          onClick={toggleVoice}
          className={cn(
            "relative rounded-full size-24 grid place-items-center text-white shadow-soft-lg transition-transform active:scale-95",
            listening ? "bg-primary animate-pulse" : "bg-primary",
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
          lang={localeToBcp47("sk")}
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

      <button
        type="button"
        onClick={submit}
        disabled={!text.trim() || submitting}
        className="btn-primary w-full text-lg"
      >
        {submitting ? (
          <>
            <Loader2 className="size-5 animate-spin" aria-hidden />
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
        <div
          role="status"
          className="fixed bottom-24 inset-x-4 max-w-md mx-auto card bg-ink text-white text-center font-bold"
        >
          {toast}
        </div>
      )}
    </section>
  );
}
