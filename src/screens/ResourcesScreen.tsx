import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useTranslation } from "react-i18next";
import { Phone, Clock, MapPin, Sparkles } from "lucide-react";
import { db } from "@/lib/db";
import { CATEGORY_EMOJI, type Post } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";
import SearchBar from "@/components/SearchBar";
import AskCommunityCard from "@/components/AskCommunityCard";
import {
  semanticRank,
  keywordRank,
  getEmbeddingStatus,
  subscribeEmbeddingStatus,
  type SearchHit,
} from "@/lib/embeddings";
import { cn } from "@/lib/utils";

// Match FeedScreen — embeddings rank everything, we JS-slice the top 3.
const MAX_SEARCH_RESULTS = 3;

export default function ResourcesScreen() {
  const { t } = useTranslation();
  const language = useAppStore((s) => s.language);
  const query = useAppStore((s) => s.searchQuery);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [embedderReady, setEmbedderReady] = useState(
    getEmbeddingStatus().phase === "ready",
  );

  const resources = useLiveQuery(
    () =>
      db.posts
        .filter((p) => p.is_resource)
        .sortBy("created_at")
        .then((list) => list.reverse()),
    [],
    [],
  );

  useEffect(() => {
    return subscribeEmbeddingStatus((s) => setEmbedderReady(s.phase === "ready"));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!resources || !query.trim()) {
        setHits(null);
        return;
      }
      if (embedderReady) {
        try {
          const ranked = await semanticRank(query, resources);
          if (!cancelled) setHits(ranked);
          return;
        } catch (err) {
          console.warn("[resources] semantic rank failed", err);
        }
      }
      if (!cancelled) setHits(keywordRank(query, resources));
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [query, resources, embedderReady]);

  const displayList: { post: Post; matched: boolean }[] = (() => {
    if (!resources) return [];
    if (!query.trim() || !hits) {
      return resources.map((post) => ({ post, matched: false }));
    }
    // Embedding cosine rank, then JS-slice to top 3. Keeps parity with
    // FeedScreen — the user sees at most three answers with the clearest
    // relevance signal so scanning stays effortless.
    const top = hits
      .filter((h) => h.score > 0)
      .slice(0, MAX_SEARCH_RESULTS);
    return top.map((h) => ({ post: h.post, matched: true }));
  })();

  const showingResults = query.trim().length > 0;

  return (
    <section className="space-y-4">
      <SearchBar />

      <header>
        <h1>{showingResults ? t("search.resultsTitle") : t("resources.title")}</h1>
        {!showingResults && (
          <p className="text-muted-foreground mt-1">{t("resources.subtitle")}</p>
        )}
      </header>

      {showingResults && displayList.length > 0 && (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Sparkles className="size-4 text-primary" aria-hidden />
          {embedderReady
            ? t("search.smartResults", { count: displayList.length })
            : t("search.keywordResults", { count: displayList.length })}
        </p>
      )}

      {showingResults && displayList.length === 0 && (
        <AskCommunityCard query={query} variant="empty" />
      )}

      {showingResults && displayList.length > 0 && (
        <AskCommunityCard query={query} variant="followup" />
      )}

      <div className="space-y-4">
        {displayList.map(({ post: r, matched }) => {
          const title =
            language === "sk"
              ? r.title_sk
              : r.title_translations?.[language as "en" | "ar" | "uk"] ?? r.title_sk;
          const body =
            language === "sk"
              ? r.body_sk ?? ""
              : r.body_translations?.[language as "en" | "ar" | "uk"] ?? r.body_sk ?? "";
          return (
            <article
              key={r.id}
              className={cn(
                "card space-y-3 transition-shadow",
                matched && "ring-2 ring-primary/60 shadow-lg",
              )}
            >
              {matched && (
                <div className="chip bg-primary/10 text-primary border border-primary/20 -mb-1">
                  <Sparkles className="size-4" aria-hidden />
                  {t("search.matchBadge")}
                </div>
              )}
              <header className="flex items-start gap-3">
                <div
                  className="text-4xl shrink-0 size-14 rounded-2xl bg-secondary/10 grid place-items-center"
                  aria-hidden
                >
                  {CATEGORY_EMOJI[r.category]}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-[22px] leading-snug">{title}</h3>
                  {r.location && (
                    <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
                      <MapPin className="size-4" aria-hidden />
                      {r.location}
                    </p>
                  )}
                </div>
              </header>
              {body && <p className="leading-relaxed">{body}</p>}
              <div className="flex flex-wrap gap-2 text-sm">
                {r.last_status && (
                  <span className="chip bg-success/15 text-success">
                    <Clock className="size-4" aria-hidden /> {r.last_status}
                  </span>
                )}
                {r.author_name && (
                  <span className="chip">
                    <Phone className="size-4" aria-hidden /> {r.author_name}
                  </span>
                )}
              </div>
            </article>
          );
        })}

        {!showingResults && resources && resources.length === 0 && (
          <p className="text-muted-foreground">{t("feed.empty")}</p>
        )}
      </div>
    </section>
  );
}
