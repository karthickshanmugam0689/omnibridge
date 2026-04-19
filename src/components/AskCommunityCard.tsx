import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { MessageSquarePlus, Sparkles, WifiOff } from "lucide-react";
import { guessCategory } from "@/lib/categorize";
import { CATEGORY_EMOJI } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";

interface AskCommunityCardProps {
  query: string;
  /**
   * "empty": shown when there are no matches at all — big, primary CTA.
   * "followup": shown beneath real results as a softer "still not satisfied?" nudge.
   */
  variant: "empty" | "followup";
}

/**
 * CTA that turns a failed/unsatisfying search into a new community post.
 * Prefills the New Post screen with the user's query and a guessed category
 * (all offline, no LLM needed — heuristic over the i18n category labels).
 */
export default function AskCommunityCard({ query, variant }: AskCommunityCardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // "Effective offline" matches the rule used everywhere else (see
  // OfflineBanner): either the browser is actually offline, or the user has
  // toggled the demo switch in Settings. When offline we hide the "Post this
  // request" CTA entirely — posts would only queue in the outbox and the
  // intent of the empty/followup card is to invite community help *now*.
  const offline = useAppStore(
    (s) => !s.online || s.offlineDemo,
  );
  const q = query.trim();
  if (!q) return null;

  const suggestedCategory = guessCategory(q);

  const goToNewPost = () => {
    navigate("/new", {
      state: {
        prefill: {
          text: q,
          category: suggestedCategory,
        },
      },
    });
  };

  if (variant === "empty") {
    return (
      <div className="card space-y-4 border-2 border-primary/30 bg-primary/5">
        <div className="flex items-start gap-3">
          <div
            className="text-4xl shrink-0 size-14 rounded-2xl bg-primary/10 grid place-items-center"
            aria-hidden
          >
            <MessageSquarePlus className="size-8 text-primary" />
          </div>
          <div className="flex-1">
            <h2 className="text-[22px] font-bold leading-snug">
              {t("search.askCommunity.emptyTitle")}
            </h2>
            <p className="text-muted-foreground mt-1">
              {t("search.askCommunity.emptyBody", { query: q })}
            </p>
          </div>
        </div>
        {offline ? (
          <p className="flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-3 text-sm text-muted-foreground">
            <WifiOff className="size-4 shrink-0" aria-hidden />
            {t("search.askCommunity.offlineHint")}
          </p>
        ) : (
          <>
            <button
              type="button"
              onClick={goToNewPost}
              className="btn-primary w-full text-lg"
            >
              <MessageSquarePlus className="size-5" aria-hidden />
              {t("search.askCommunity.cta")}
            </button>
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Sparkles className="size-4 text-primary" aria-hidden />
              {t("search.askCommunity.categoryHint", {
                emoji: CATEGORY_EMOJI[suggestedCategory],
                category: t(`categories.${suggestedCategory}`),
              })}
            </p>
          </>
        )}
      </div>
    );
  }

  // Followup variant is pure CTA — hide it entirely when offline, no fallback.
  if (offline) return null;

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-3 py-2 text-sm",
      )}
    >
      <span className="text-muted-foreground flex-1 truncate">
        {t("search.askCommunity.followupTitle")}
      </span>
      <button
        type="button"
        onClick={goToNewPost}
        className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 text-primary px-3 py-1.5 font-semibold hover:bg-primary/15 transition-colors shrink-0"
      >
        <MessageSquarePlus className="size-4" aria-hidden />
        {t("search.askCommunity.cta")}
      </button>
    </div>
  );
}
