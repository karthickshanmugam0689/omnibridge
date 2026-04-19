import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Heart, Loader2, Sparkles, X } from "lucide-react";
import { db } from "@/lib/db";
import { useLiveQuery } from "dexie-react-hooks";
import { resolvePost } from "@/lib/posts";
import { pullProfilePoints } from "@/lib/profile";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";
import type { Post, Response } from "@/lib/types";

/**
 * Points awarded per thank-you. MUST match `POINTS_PER_THANK_YOU` in
 * `api/resolve.ts` — we show it in the dialog subtitle so the author
 * knows exactly how generous they're being with their thank-you.
 */
const POINTS_PER_THANK_YOU = 10;

interface ResolveDialogProps {
  post: Post;
  open: boolean;
  onClose(): void;
  /**
   * Fires after the server confirms resolution (or the optimistic local
   * write commits when offline). The parent uses this to flip a toast.
   */
  onResolved?(result: {
    helperName: string | null;
    pointsAwarded: number;
  }): void;
}

interface Candidate {
  clientId: string;
  name: string;
  emoji: string;
  hasOffered: boolean;
  lastAt: string;
}

/**
 * Modal used by the post author to close their request.
 *
 * The list of candidates is derived from the responses thread: every unique
 * responder (excluding the author themselves) shows up, sorted with offerers
 * first and most-recent-within-group next. Private replies count even though
 * they're hidden from everyone else — the asker knows about them.
 *
 * Accessibility notes:
 *   - Rendered via a portal and focus-trapped to the dialog root so a screen
 *     reader doesn't wander back into the feed while the modal is open.
 *   - `aria-modal` + `role=dialog` announce the purpose; the title is the
 *     labelled name via `aria-labelledby`.
 *   - Escape closes; tapping the backdrop also closes (mirrors OnboardingModal).
 */
export default function ResolveDialog({ post, open, onClose, onResolved }: ResolveDialogProps) {
  const { t } = useTranslation();
  const viewerId = useAppStore((s) => s.user.clientId);
  const [busyFor, setBusyFor] = useState<string | "__none__" | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // All responses for this post (including private ones, which only this
  // author can see anyway). Live so if a new offer comes in while the modal
  // is open, the author can pick the just-arrived helper without closing.
  const responses = useLiveQuery<Response[], Response[]>(
    () =>
      db.responses
        .where("[post_id+created_at]")
        .between([post.id, ""], [post.id, "\uffff"])
        .toArray(),
    [post.id],
    [],
  );

  const candidates: Candidate[] = useMemo(() => {
    // Collapse multiple replies from the same person into one candidate.
    const byClient = new Map<string, Candidate>();
    for (const r of responses ?? []) {
      if (!r.author_client_id || r.author_client_id === viewerId) continue;
      const existing = byClient.get(r.author_client_id);
      if (!existing) {
        byClient.set(r.author_client_id, {
          clientId: r.author_client_id,
          name: r.author_name?.trim() || t("responses.anonymous"),
          emoji: r.author_emoji ?? "🙂",
          hasOffered: !!r.is_offer,
          lastAt: r.created_at,
        });
      } else {
        if (r.is_offer) existing.hasOffered = true;
        if (r.created_at > existing.lastAt) existing.lastAt = r.created_at;
      }
    }
    // Offerers first (they put themselves forward), then by most recent reply.
    return Array.from(byClient.values()).sort((a, b) => {
      if (a.hasOffered !== b.hasOffered) return a.hasOffered ? -1 : 1;
      return a.lastAt < b.lastAt ? 1 : -1;
    });
  }, [responses, viewerId, t]);

  // Close on Escape. We don't use the native <dialog> element because it
  // interacts poorly with our portal + Tailwind backdrop styling.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busyFor) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busyFor, onClose]);

  // Move focus into the dialog when it opens so keyboard + screen-reader
  // users don't stay on the trigger button behind the backdrop.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      const first = dialogRef.current?.querySelector<HTMLElement>(
        "[data-autofocus]",
      );
      first?.focus();
    }, 30);
    return () => window.clearTimeout(id);
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const handleResolve = async (candidate: Candidate | null) => {
    const key = candidate?.clientId ?? "__none__";
    setBusyFor(key);
    try {
      const result = await resolvePost(post.id, candidate?.clientId ?? null);
      // Refresh the viewer's own points if they happen to be the helper who
      // got thanked. For the author themselves nothing changes but a noop
      // fetch is cheap.
      void pullProfilePoints();
      onResolved?.({
        helperName: candidate?.name ?? null,
        pointsAwarded: result.pointsAwarded,
      });
      onClose();
    } catch (err) {
      console.error("[resolve] dialog submit failed:", err);
      onResolved?.({ helperName: candidate?.name ?? null, pointsAwarded: -1 });
    } finally {
      setBusyFor(null);
    }
  };

  const titleId = `resolve-title-${post.id}`;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busyFor) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg rounded-2xl bg-white shadow-soft-lg max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="size-12 shrink-0 rounded-2xl bg-primary/10 text-primary grid place-items-center">
              <Sparkles className="size-6" aria-hidden />
            </div>
            <div>
              <h2 id={titleId} className="text-xl font-bold leading-snug">
                {t("resolve.dialogTitle")}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                {t("resolve.dialogHint", { points: POINTS_PER_THANK_YOU })}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => !busyFor && onClose()}
            aria-label={t("resolve.cancel")}
            className="shrink-0 size-10 min-h-touch grid place-items-center rounded-full hover:bg-muted text-ink disabled:opacity-50"
            disabled={!!busyFor}
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <ul className="divide-y divide-border">
          {candidates.length === 0 && (
            <li className="p-5 text-base text-muted-foreground">
              {t("resolve.noResponders")}
            </li>
          )}
          {candidates.map((c, index) => {
            const busy = busyFor === c.clientId;
            return (
              <li key={c.clientId}>
                <button
                  type="button"
                  data-autofocus={index === 0 ? true : undefined}
                  onClick={() => handleResolve(c)}
                  disabled={!!busyFor}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-4 sm:px-5 text-left transition",
                    "hover:bg-amber-50 focus-visible:outline-none focus-visible:bg-amber-50",
                    busy && "bg-amber-50",
                    busyFor && !busy && "opacity-60",
                  )}
                >
                  <div className="size-12 shrink-0 rounded-full bg-muted grid place-items-center text-2xl" aria-hidden>
                    {c.emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-semibold text-ink truncate">
                      {c.name}
                    </p>
                    {c.hasOffered && (
                      <span className="chip bg-amber-100 text-amber-900 border border-amber-300 text-xs mt-1 inline-flex items-center gap-1">
                        <Heart className="size-3.5" aria-hidden />
                        {t("resolve.offeredChip")}
                      </span>
                    )}
                  </div>
                  <span className="inline-flex items-center gap-2 min-h-touch rounded-xl bg-amber-500 text-white px-3 py-2 font-semibold">
                    {busy ? (
                      <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
                    ) : (
                      <Heart className="size-4" aria-hidden />
                    )}
                    <span className="hidden sm:inline">
                      {t("resolve.thankButton", { name: c.name })}
                    </span>
                    <span className="sm:hidden">+{POINTS_PER_THANK_YOU}</span>
                  </span>
                </button>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => handleResolve(null)}
              disabled={!!busyFor}
              data-autofocus={candidates.length === 0 ? true : undefined}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-4 sm:px-5 text-left transition",
                "hover:bg-muted focus-visible:outline-none focus-visible:bg-muted",
                busyFor === "__none__" && "bg-muted",
                busyFor && busyFor !== "__none__" && "opacity-60",
              )}
            >
              <div className="size-12 shrink-0 rounded-full bg-muted grid place-items-center" aria-hidden>
                <Sparkles className="size-5 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-base font-semibold text-ink">
                  {t("resolve.noHelper")}
                </p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {t("resolve.noHelperHint")}
                </p>
              </div>
              {busyFor === "__none__" && (
                <Loader2 className="size-5 motion-safe:animate-spin text-muted-foreground" aria-hidden />
              )}
            </button>
          </li>
        </ul>
      </div>
    </div>,
    document.body,
  );
}
