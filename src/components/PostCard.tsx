import { useState } from "react";
import { useTranslation } from "react-i18next";
import { HeartHandshake, Volume2, VolumeX, MapPin } from "lucide-react";
import type { Post } from "@/lib/types";
import { CATEGORY_EMOJI } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";
import { speak, stopSpeaking, localeToBcp47, voiceOutputSupported } from "@/lib/voice";
import { timeAgo } from "@/lib/utils";

export default function PostCard({ post }: { post: Post }) {
  const { t } = useTranslation();
  const language = useAppStore((s) => s.language);
  const [speaking, setSpeaking] = useState(false);
  const [helped, setHelped] = useState(false);

  const title =
    language === "sk"
      ? post.title_sk
      : post.title_translations?.[language as "en" | "ar" | "uk"] ?? post.title_sk;
  const body =
    language === "sk"
      ? post.body_sk ?? ""
      : post.body_translations?.[language as "en" | "ar" | "uk"] ?? post.body_sk ?? "";

  const toggleSpeak = () => {
    if (!voiceOutputSupported()) return;
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    speak({
      text: [title, body].filter(Boolean).join(". "),
      lang: localeToBcp47(language),
      onEnd: () => setSpeaking(false),
    });
  };

  return (
    <article className="card space-y-3">
      <header className="flex items-start gap-3">
        <div
          className="text-4xl leading-none shrink-0 size-14 rounded-2xl bg-muted grid place-items-center"
          aria-hidden
        >
          {CATEGORY_EMOJI[post.category]}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-[22px] font-bold leading-snug">{title}</h3>
          <p className="text-sm text-muted-foreground mt-1">
            <span aria-hidden>{post.author_emoji ?? "🙂"}</span>{" "}
            {post.author_name ?? t("feed.title")} ·{" "}
            {t("feed.ago", { time: timeAgo(post.created_at, language) })}
          </p>
          {post.location && (
            <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
              <MapPin className="size-4" aria-hidden />
              {post.location}
            </p>
          )}
        </div>
        <span className="chip bg-secondary/10 text-secondary">
          {t(`categories.${post.category}`)}
        </span>
      </header>

      {body && <p className="text-base leading-relaxed">{body}</p>}

      <footer className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={toggleSpeak}
          className="btn-ghost"
          aria-pressed={speaking}
        >
          {speaking ? (
            <>
              <VolumeX className="size-5" aria-hidden />
              {t("feed.stopReading")}
            </>
          ) : (
            <>
              <Volume2 className="size-5" aria-hidden />
              {t("feed.readAloud")}
            </>
          )}
        </button>
        {!post.is_resource && (
          <button
            type="button"
            onClick={() => setHelped(true)}
            disabled={helped}
            className="btn-primary"
          >
            <HeartHandshake className="size-5" aria-hidden />
            {helped ? t("feed.markedHelped") : t("feed.iCanHelp")}
          </button>
        )}
      </footer>
    </article>
  );
}
