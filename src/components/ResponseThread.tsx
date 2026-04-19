import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLiveQuery } from "dexie-react-hooks";
import { Send, Bell, Loader2, Mic, MicOff, Heart, Lock, X } from "lucide-react";
import { db } from "@/lib/db";
import {
  createResponse,
  refreshResponses,
  sendDemoReplyNotification,
  buildOfferTranslations,
} from "@/lib/responses";
import {
  startListening,
  voiceInputSupported,
  localeToBcp47,
  type VoiceSession,
} from "@/lib/voice";
import { useAppStore } from "@/store/useAppStore";
import { timeAgo, cn } from "@/lib/utils";
import type { Post, Response, SourceLang } from "@/lib/types";
import ToastBanner from "./ToastBanner";

interface ResponseThreadProps {
  post: Post;
}

/**
 * What kind of message is the composer currently sending?
 *   - "public": normal reply, visible to everyone.
 *   - "offer": `is_offer=true`, one-tap "Yes, I can help" — handled by a
 *     dedicated button so this mode never actually reaches the textarea.
 *   - "private": 1-to-1 DM between the asker and an accepted helper.
 */
type ComposerMode =
  | { kind: "public" }
  | { kind: "private"; targetClientId: string; targetName: string; targetEmoji: string | null };

/**
 * Inline thread of replies under a post.
 *
 * Two new behaviours layered on top of the original public reply thread:
 *
 * 1. "Yes, I can help" one-tap offer — shown to non-authors who haven't yet
 *    offered on this post. Sends an `is_offer=true` response with a fixed,
 *    pre-translated body so every viewer sees it in their own language.
 *
 * 2. Lightweight private DM — after a helper offers, the asker sees a gold
 *    offer card with "Send private message". Tapping it flips the composer
 *    into private mode. Private messages carry `is_private=true` and
 *    `visible_to=[asker, helper]`; the thread filters them out for everyone
 *    else, so neighbours browsing the post never see the private exchange.
 */
export default function ResponseThread({ post }: ResponseThreadProps) {
  const { t } = useTranslation();
  const language = useAppStore((s) => s.language);
  const user = useAppStore((s) => s.user);
  const isAuthor = !!post.author_client_id && post.author_client_id === user.clientId;
  const viewerId = user.clientId;
  // A resolved post is read-only for new replies: we hide the composer and
  // the "Yes, I can help" button. The asker can still reopen the thread to
  // re-read the exchange that got them there.
  const isResolved = !!post.resolved_at;

  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [offering, setOffering] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [composer, setComposer] = useState<ComposerMode>({ kind: "public" });
  const [toast, setToast] = useState<{ message: string; variant: "success" | "error" } | null>(null);
  const [listening, setListening] = useState(false);
  const voiceSessionRef = useRef<VoiceSession | null>(null);
  // Snapshot of the draft when a voice session starts, so each interim
  // transcript result *replaces* the spoken portion instead of accumulating
  // every partial update on top of itself.
  const voiceBaseRef = useRef<string>("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const canUseVoice = voiceInputSupported();

  const rawResponses = useLiveQuery<Response[], Response[]>(
    () =>
      db.responses
        .where("[post_id+created_at]")
        .between([post.id, ""], [post.id, "\uffff"])
        .toArray(),
    [post.id],
    [],
  );

  // Filter private messages: they're visible only to the asker and the
  // accepted helper (both listed in `visible_to`). Everyone else sees the
  // thread *as if the private reply never existed* — no ghost cards, no
  // "unavailable" placeholder.
  const responses = useMemo(() => {
    const src = rawResponses ?? [];
    return src.filter((r) => {
      if (!r.is_private) return true;
      const allowed = r.visible_to ?? [];
      return allowed.includes(viewerId);
    });
  }, [rawResponses, viewerId]);

  // Whether the current viewer has already offered to help on this post.
  // One offer per person keeps the asker's inbox sane.
  const alreadyOffered = useMemo(
    () =>
      (rawResponses ?? []).some(
        (r) => r.is_offer && r.author_client_id === viewerId,
      ),
    [rawResponses, viewerId],
  );

  // Pull any responses we don't have yet from Supabase the first time the
  // thread mounts (no-op when Supabase isn't configured).
  useEffect(() => {
    void refreshResponses(post.id);
  }, [post.id]);

  // Release the mic if the thread unmounts (e.g. the user collapses it)
  // or switches language mid-dictation. We stop but intentionally don't
  // auto-restart — the user taps again to resume, matching the feed/post
  // voice UX.
  useEffect(() => {
    return () => voiceSessionRef.current?.stop();
  }, []);
  useEffect(() => {
    if (listening) {
      voiceSessionRef.current?.stop();
      setListening(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  const toggleVoice = () => {
    if (listening) {
      voiceSessionRef.current?.stop();
      setListening(false);
      return;
    }
    if (!canUseVoice) return;
    voiceBaseRef.current = draft;
    setListening(true);
    voiceSessionRef.current = startListening({
      lang: localeToBcp47(language),
      onTranscript: (transcript, isFinal) => {
        const base = voiceBaseRef.current;
        const sep = base && !base.endsWith(" ") ? " " : "";
        setDraft(`${base}${sep}${transcript}`);
        if (isFinal) setListening(false);
      },
      onError: () => setListening(false),
      onEnd: () => setListening(false),
    });
  };

  const showToast = (message: string, variant: "success" | "error" = "success") => {
    setToast({ message, variant });
  };

  /** Send the one-tap offer. We pre-translate from fixed i18n strings so
   *  no LLM call is needed and offline senders see instant translations. */
  const sendOffer = async () => {
    if (offering || alreadyOffered || isAuthor) return;
    setOffering(true);
    try {
      await createResponse({
        postId: post.id,
        // Keep the author-visible message in their own language so their
        // reply list reads naturally. Other viewers fall back to the
        // pre-computed translations below.
        message: t("responses.offerBody"),
        is_offer: true,
        message_translations: buildOfferTranslations(),
      });
      showToast(t("responses.offerSent"));
    } catch (err) {
      console.error("[thread] sendOffer failed:", err);
      showToast(t("responses.error"), "error");
    } finally {
      setOffering(false);
    }
  };

  const submit = async () => {
    const message = draft.trim();
    if (!message || submitting) return;
    voiceSessionRef.current?.stop();
    setListening(false);
    setSubmitting(true);
    try {
      if (composer.kind === "private") {
        await createResponse({
          postId: post.id,
          message,
          is_private: true,
          // Both sides of the DM are allowed to see it. Anyone else's
          // ResponseThread will filter it out.
          visible_to: [viewerId, composer.targetClientId],
        });
      } else {
        await createResponse({ postId: post.id, message });
      }
      setDraft("");
      showToast(t("responses.sent"));
    } catch (err) {
      console.error("[thread] createResponse failed:", err);
      showToast(t("responses.error"), "error");
    } finally {
      setSubmitting(false);
    }
  };

  const startPrivateReply = (helper: {
    clientId: string;
    name: string;
    emoji: string | null;
  }) => {
    setComposer({
      kind: "private",
      targetClientId: helper.clientId,
      targetName: helper.name,
      targetEmoji: helper.emoji,
    });
    // Give the textarea focus so the asker can start typing immediately —
    // important for screen-reader users too: the "private mode" label is
    // aria-live and gets announced on focus change.
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const cancelPrivate = () => setComposer({ kind: "public" });

  const sendDemo = async () => {
    setDemoLoading(true);
    try {
      const ok = await sendDemoReplyNotification(post);
      showToast(
        ok ? t("responses.demoSent") : t("responses.demoUnavailable"),
        ok ? "success" : "error",
      );
    } finally {
      setDemoLoading(false);
    }
  };

  // Only the asker of this post gets "send private message" affordances,
  // and only while the composer isn't already locked into a DM with someone.
  const showOfferCtas = isAuthor && composer.kind === "public";

  return (
    <div className="space-y-3 pt-2">
      {responses && responses.length > 0 && (
        <ul className="space-y-2">
          {responses.map((r) => {
            const mine = r.author_client_id === viewerId;
            const viewerLang = language as SourceLang;
            const localised =
              r.message_translations?.[viewerLang] ?? r.message;
            const showTranslatedHint =
              r.source_lang && r.source_lang !== viewerLang && localised !== r.message;
            const authorName = r.author_name?.trim() || t("responses.anonymous");
            const authorEmoji = r.author_emoji ?? "🙂";
            const helperId = r.author_client_id ?? null;

            // Offer cards get a gold accent + a call-to-action visible only
            // to the post's author, so they can flip into a 1-to-1 DM with
            // the helper who offered.
            const isOffer = !!r.is_offer;
            const canAcceptOffer =
              isOffer && showOfferCtas && !mine && !!helperId;

            return (
              <li
                key={r.id}
                className={cn(
                  "rounded-xl border px-3 py-3 text-base space-y-2",
                  mine && !isOffer && "border-primary/30 bg-primary/5",
                  !mine && !isOffer && !r.is_private && "border-border bg-white",
                  r.is_private && "border-violet-300 bg-violet-50",
                  isOffer && "border-amber-300 bg-amber-50",
                )}
              >
                <div className="flex items-center gap-2 text-muted-foreground text-sm flex-wrap">
                  <span aria-hidden>{authorEmoji}</span>
                  <span className="font-semibold text-foreground">{authorName}</span>
                  {mine && (
                    <span className="chip bg-primary/10 text-primary border border-primary/20 text-xs">
                      {t("responses.you")}
                    </span>
                  )}
                  {isOffer && (
                    <span className="chip bg-amber-100 text-amber-900 border border-amber-300 text-xs inline-flex items-center gap-1">
                      <Heart className="size-3.5" aria-hidden />
                      {t("responses.yesICanHelp")}
                    </span>
                  )}
                  {r.is_private && (
                    <span className="chip bg-violet-100 text-violet-900 border border-violet-300 text-xs inline-flex items-center gap-1">
                      <Lock className="size-3.5" aria-hidden />
                      {t("responses.privateBadge")}
                    </span>
                  )}
                  <span>·</span>
                  <span>{t("feed.ago", { time: timeAgo(r.created_at, language) })}</span>
                  {showTranslatedHint && (
                    <span className="chip bg-muted text-muted-foreground text-xs">
                      {t("responses.translatedFrom", { lang: t(`languages.${r.source_lang}`) })}
                    </span>
                  )}
                </div>
                <p className="leading-relaxed">{localised}</p>
                {canAcceptOffer && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() =>
                        startPrivateReply({
                          clientId: helperId as string,
                          name: authorName,
                          emoji: r.author_emoji ?? null,
                        })
                      }
                      className="inline-flex items-center gap-2 min-h-touch rounded-xl bg-amber-500 text-white px-4 py-2 font-semibold hover:bg-amber-600 transition-colors"
                    >
                      <Lock className="size-4" aria-hidden />
                      {t("responses.sendPrivateMessage")}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Resolved posts are a read-only archive. Show a gentle "closed"
          note so anyone arriving from search isn't confused by the lack
          of a composer. */}
      {isResolved && (
        <p
          role="status"
          className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-3 text-sm text-emerald-900"
        >
          {t("resolve.solvedLocked")}
        </p>
      )}

      {/* One-tap "Yes, I can help" — lives above the composer so it stays
          the first thing non-authors see when they open the thread. */}
      {!isAuthor && !alreadyOffered && !isResolved && (
        <button
          type="button"
          onClick={sendOffer}
          disabled={offering}
          className="w-full inline-flex items-center justify-center gap-2 min-h-touch rounded-xl bg-amber-500 text-white px-4 py-3 font-semibold hover:bg-amber-600 transition-colors disabled:opacity-60"
        >
          {offering ? (
            <Loader2 className="size-5 motion-safe:animate-spin" aria-hidden />
          ) : (
            <Heart className="size-5" aria-hidden />
          )}
          <span>{t("responses.yesICanHelp")}</span>
        </button>
      )}
      {!isAuthor && !alreadyOffered && !isResolved && (
        <p className="text-sm text-muted-foreground text-center">
          {t("responses.yesICanHelpHint")}
        </p>
      )}

      {!isResolved && (!isAuthor || composer.kind === "private") && (
        <div
          className={cn(
            "rounded-xl border p-3 space-y-3",
            composer.kind === "private"
              ? "border-violet-300 bg-violet-50"
              : "border-border bg-muted/30",
          )}
        >
          {composer.kind === "private" && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center justify-between gap-2 text-sm text-violet-900"
            >
              <span className="inline-flex items-center gap-2 font-semibold">
                <Lock className="size-4" aria-hidden />
                {t("responses.privatePlaceholder", { name: composer.targetName })}
              </span>
              <button
                type="button"
                onClick={cancelPrivate}
                aria-label={t("common.close", { defaultValue: "Close" })}
                className="inline-flex items-center gap-1 min-h-touch rounded-lg border border-violet-300 bg-white px-3 py-1 text-violet-900 hover:bg-violet-100"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          )}
          <div className="flex items-start gap-2">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={
                composer.kind === "private"
                  ? t("responses.privatePlaceholder", { name: composer.targetName })
                  : t("responses.placeholder")
              }
              aria-label={
                composer.kind === "private"
                  ? t("responses.privatePlaceholder", { name: composer.targetName })
                  : t("responses.placeholder")
              }
              lang={localeToBcp47(language)}
              rows={3}
              className={cn(
                "flex-1 resize-none rounded-xl border px-3 py-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                composer.kind === "private"
                  ? "border-violet-300 bg-white"
                  : "border-border bg-white",
              )}
            />
            {canUseVoice && (
              <button
                type="button"
                onClick={toggleVoice}
                aria-pressed={listening}
                aria-label={
                  listening
                    ? t("responses.stopVoice")
                    : t("responses.voiceReply")
                }
                title={
                  listening
                    ? t("responses.stopVoice")
                    : t("responses.voiceReply")
                }
                className={cn(
                  "shrink-0 size-14 min-h-touch grid place-items-center rounded-xl border transition",
                  listening
                    ? "border-primary bg-primary text-primary-foreground motion-safe:animate-pulse"
                    : "border-border bg-white text-ink hover:bg-muted",
                )}
              >
                {listening ? (
                  <MicOff className="size-6" aria-hidden />
                ) : (
                  <Mic className="size-6" aria-hidden />
                )}
              </button>
            )}
          </div>
          {listening && (
            <p
              role="status"
              aria-live="polite"
              className="text-sm text-primary font-semibold"
            >
              {t("responses.listening")}
            </p>
          )}
          {composer.kind === "private" && (
            <p className="text-xs text-violet-900/80">
              {t("responses.privateHint", { name: composer.targetName })}
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              <span aria-hidden>{user.emoji}</span>{" "}
              {user.name?.trim() || t("responses.anonymous")}
            </p>
            <button
              type="button"
              onClick={submit}
              disabled={!draft.trim() || submitting}
              className="btn-primary"
            >
              {submitting ? (
                <Loader2 className="size-5 motion-safe:animate-spin" aria-hidden />
              ) : composer.kind === "private" ? (
                <Lock className="size-5" aria-hidden />
              ) : (
                <Send className="size-5" aria-hidden />
              )}
              {t("responses.send")}
            </button>
          </div>
        </div>
      )}

      {isAuthor && composer.kind === "public" && !isResolved && (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 px-3 py-3 text-sm text-muted-foreground flex items-center justify-between gap-2 flex-wrap">
          <span>{t("responses.yourPost")}</span>
          <button
            type="button"
            onClick={sendDemo}
            disabled={demoLoading}
            className="inline-flex items-center gap-2 min-h-touch rounded-xl bg-primary/10 text-primary px-4 py-2 font-semibold hover:bg-primary/15 transition-colors disabled:opacity-50"
            title={t("responses.demoHint")}
          >
            {demoLoading ? (
              <Loader2 className="size-5 motion-safe:animate-spin" aria-hidden />
            ) : (
              <Bell className="size-5" aria-hidden />
            )}
            {t("responses.demoButton")}
          </button>
        </div>
      )}

      {toast && (
        <ToastBanner
          message={toast.message}
          variant={toast.variant}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
