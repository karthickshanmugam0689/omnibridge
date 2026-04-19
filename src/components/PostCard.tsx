import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import {
  MessageSquare,
  Volume2,
  VolumeX,
  MapPin,
  Sparkles,
  ChevronDown,
  ChevronUp,
  BellRing,
  CheckCircle2,
  Siren,
} from "lucide-react";
import type { Post, Response, SourceLang } from "@/lib/types";
import { CATEGORY_EMOJI } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";
import { db } from "@/lib/db";
import { speak, stopSpeaking, localeToBcp47, voiceOutputSupported } from "@/lib/voice";
import { timeAgo, cn } from "@/lib/utils";
import ResponseThread from "./ResponseThread";
import ResolveDialog from "./ResolveDialog";
import ToastBanner from "./ToastBanner";

interface PostCardProps {
  post: Post;
  highlighted?: boolean;
  /** When true, render the thread expanded on first paint (e.g. opened via push tap). */
  defaultThreadOpen?: boolean;
}

export default function PostCard({ post, highlighted = false, defaultThreadOpen = false }: PostCardProps) {
  const { t } = useTranslation();
  const language = useAppStore((s) => s.language);
  const viewerId = useAppStore((s) => s.user.clientId);
  // Only the post author sees the "N helpers alerted" chip; strangers don't
  // need to know how many volunteers are on-call for someone else's request.
  const isAuthor = !!post.author_client_id && post.author_client_id === viewerId;
  const matchStat = useAppStore((s) => s.matchStats[post.id]);
  const [speaking, setSpeaking] = useState(false);
  const [threadOpen, setThreadOpen] = useState(defaultThreadOpen);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    variant: "success" | "error";
  } | null>(null);

  const responseCount = useLiveQuery<number, number>(
    () =>
      db.responses
        .where("[post_id+created_at]")
        .between([post.id, ""], [post.id, "\uffff"])
        .count(),
    [post.id],
    0,
  );

  const isResolved = !!post.resolved_at;
  const resolvedHelperId = post.resolved_helper_client_id ?? null;
  // Urgent badge is suppressed once a post is resolved — once it's solved
  // the fire is out, and we don't want a stale red halo screaming at people
  // in the feed. Also suppressed for resource posts (they can't be urgent).
  const isUrgent = post.is_urgent === true && !isResolved && !post.is_resource;

  // When a post is resolved *with* a specific helper, look up the most
  // recent reply from that helper to show their name/emoji on the "Solved by"
  // chip. Falls back to `null` if the helper never actually replied on this
  // device (e.g. asker thanked someone from memory after offline meetup).
  const resolvedHelper = useLiveQuery<Response | null, null>(
    async () => {
      if (!isResolved || !resolvedHelperId) return null;
      const rows = await db.responses
        .where("[post_id+created_at]")
        .between([post.id, ""], [post.id, "\uffff"])
        .toArray();
      const match = rows.find((r) => r.author_client_id === resolvedHelperId);
      return match ?? null;
    },
    [post.id, isResolved, resolvedHelperId],
    null,
  );

  const title =
    language === "sk"
      ? post.title_sk
      : post.title_translations?.[language as "en" | "ar" | "uk"] ?? post.title_sk;
  const body =
    language === "sk"
      ? post.body_sk ?? ""
      : post.body_translations?.[language as "en" | "ar" | "uk"] ?? post.body_sk ?? "";

  // Show a small "translated from X" badge when the viewer is reading a
  // non-source-language version. We skip the badge when source_lang is
  // missing (legacy rows) or matches the viewer — nothing to announce there.
  const sourceLang = (post.source_lang ?? "sk") as SourceLang;
  const showTranslatedHint = sourceLang !== (language as SourceLang);

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

  const resolvedHelperName =
    resolvedHelper?.author_name?.trim() || null;
  const resolvedHelperEmoji = resolvedHelper?.author_emoji ?? "🤝";

  return (
    <article
      className={cn(
        "card space-y-3 transition-shadow",
        highlighted && "ring-2 ring-primary/60 shadow-lg",
        isResolved && "ring-1 ring-emerald-300 bg-emerald-50/40",
        // Red halo wins over resolved green on the very rare cross-state
        // because we only apply it when !isResolved (see isUrgent above).
        isUrgent && "ring-2 ring-red-500 shadow-lg bg-red-50/40",
      )}
      // Announce urgency to assistive tech — the siren emoji alone isn't
      // reliable. `aria-label` on the article is picked up by VoiceOver /
      // TalkBack before it reads the inner content.
      aria-label={isUrgent ? t("postCard.urgentAria", { title }) : undefined}
    >
      {isUrgent && (
        <div
          className="chip bg-red-500 text-white border border-red-600 -mb-1 inline-flex items-center gap-1 motion-safe:animate-pulse"
          role="status"
        >
          <Siren className="size-4" aria-hidden />
          {t("postCard.urgent")}
        </div>
      )}
      {highlighted && !isResolved && (
        <div className="chip bg-primary/10 text-primary border border-primary/20 -mb-1">
          <Sparkles className="size-4" aria-hidden />
          {t("search.matchBadge")}
        </div>
      )}
      {isResolved && (
        <div className="flex flex-wrap items-center gap-2 -mb-1">
          <div className="chip bg-emerald-100 text-emerald-900 border border-emerald-300 inline-flex items-center gap-1">
            <CheckCircle2 className="size-4" aria-hidden />
            {t("resolve.solvedBadge")}
          </div>
          {resolvedHelperName && (
            <span className="text-sm text-emerald-900 inline-flex items-center gap-1">
              <span aria-hidden>{resolvedHelperEmoji}</span>
              {t("resolve.solvedBy", { name: resolvedHelperName })}
            </span>
          )}
          {!resolvedHelperName && isAuthor && (
            <span className="text-sm text-emerald-900">
              {t("resolve.solvedByYou")}
            </span>
          )}
        </div>
      )}
      {isAuthor && matchStat && matchStat.alerted > 0 && !isResolved && (
        <div className="chip bg-amber-100 text-amber-900 border border-amber-300 -mb-1 inline-flex items-center gap-1">
          <BellRing className="size-4" aria-hidden />
          {t("postCard.alerted", { count: matchStat.alerted })}
        </div>
      )}
      {/* When we know we alerted zero helpers, give the author a hint instead
          of silence. Three reasons the server sends back:
            • skipped === "outside_hours" → it's between 23:00 and 05:00
              local and the post wasn't marked urgent.
            • profilesChecked === 0 → nobody has opted in as a helper for
              this category yet. Usually on a fresh/demo DB.
            • otherwise → people opted in, but nobody matched availability.
          Only shown to the author, and never for resources (resources don't
          match helpers by design). */}
      {isAuthor &&
        matchStat &&
        matchStat.alerted === 0 &&
        !isResolved &&
        !post.is_resource && (
          <div
            className="chip bg-muted text-muted-foreground border -mb-1 inline-flex items-center gap-1"
            role="status"
          >
            <BellRing className="size-4" aria-hidden />
            {matchStat.skipped === "outside_hours"
              ? t("postCard.alertedNoneOutsideHours")
              : matchStat.profilesChecked === 0
                ? t("postCard.alertedNoneNoHelpers")
                : t("postCard.alertedNoneBusy")}
          </div>
        )}
      <header className="flex items-start gap-3">
        <div
          className="text-4xl leading-none shrink-0 size-14 rounded-2xl bg-muted grid place-items-center"
          aria-hidden
        >
          {CATEGORY_EMOJI[post.category]}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-[22px] font-bold leading-snug">{title}</h3>
          <p className="text-sm text-muted-foreground mt-1 flex flex-wrap items-center gap-x-1 gap-y-1">
            <span>
              <span aria-hidden>{post.author_emoji ?? "🙂"}</span>{" "}
              {post.author_name ?? t("feed.title")} ·{" "}
              {t("feed.ago", { time: timeAgo(post.created_at, language) })}
            </span>
            {showTranslatedHint && (
              <span className="chip bg-muted text-muted-foreground text-xs">
                {t("responses.translatedFrom", { lang: t(`languages.${sourceLang}`) })}
              </span>
            )}
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
            onClick={() => setThreadOpen((v) => !v)}
            className="btn-primary"
            aria-expanded={threadOpen}
          >
            <MessageSquare className="size-5" aria-hidden />
            {responseCount && responseCount > 0
              ? t("responses.replyWithCount", { count: responseCount })
              : t("responses.reply")}
            {threadOpen ? (
              <ChevronUp className="size-4" aria-hidden />
            ) : (
              <ChevronDown className="size-4" aria-hidden />
            )}
          </button>
        )}
        {isAuthor && !post.is_resource && !isResolved && (
          <button
            type="button"
            onClick={() => setResolveOpen(true)}
            className="inline-flex items-center gap-2 min-h-touch rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-900 px-4 py-2 font-semibold hover:bg-emerald-100 transition-colors"
          >
            <CheckCircle2 className="size-5" aria-hidden />
            {t("resolve.markSolved")}
          </button>
        )}
      </footer>

      {!post.is_resource && threadOpen && <ResponseThread post={post} />}

      {isAuthor && !post.is_resource && (
        <ResolveDialog
          post={post}
          open={resolveOpen}
          onClose={() => setResolveOpen(false)}
          onResolved={({ helperName, pointsAwarded }) => {
            if (pointsAwarded < 0) {
              setToast({ message: t("resolve.toastError"), variant: "error" });
              return;
            }
            if (pointsAwarded > 0 && helperName) {
              setToast({
                message: t("resolve.toastThanked", {
                  name: helperName,
                  points: pointsAwarded,
                }),
                variant: "success",
              });
            } else {
              setToast({
                message: t("resolve.toastClosed"),
                variant: "success",
              });
            }
          }}
        />
      )}

      {toast && (
        <ToastBanner
          message={toast.message}
          variant={toast.variant}
          onClose={() => setToast(null)}
        />
      )}
    </article>
  );
}
