import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronDown, ChevronUp, CheckCircle2, Loader2, Mic, Sparkles, Wifi } from "lucide-react";
import { db } from "@/lib/db";
import { refreshFeed } from "@/lib/posts";
import { useAppStore } from "@/store/useAppStore";
import PostCard from "@/components/PostCard";
import SearchBar from "@/components/SearchBar";
import AskCommunityCard from "@/components/AskCommunityCard";
import {
  semanticRank,
  keywordRank,
  getEmbeddingStatus,
  subscribeEmbeddingStatus,
  filterRelevantHits,
  type SearchHit,
} from "@/lib/embeddings";
import type { Post } from "@/lib/types";

// When the user is offline we intentionally show a tighter result list so
// they can scan the most likely answers in one glance, and we lean on the
// "go online for more" nudge below to set expectations rather than burying
// weaker matches under the top ones.
const OFFLINE_MAX_RESULTS = 3;

export default function FeedScreen() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const setLastSyncedAt = useAppStore((s) => s.setLastSyncedAt);
  const query = useAppStore((s) => s.searchQuery);
  const offline = useAppStore((s) => !s.online || s.offlineDemo);
  const routerLocation = useLocation();
  const navigate = useNavigate();
  // When opened from a notification tap (`/?post=<id>`) auto-expand that post.
  const focusedPostId = useMemo(() => {
    const params = new URLSearchParams(routerLocation.search);
    return params.get("post");
  }, [routerLocation.search]);
  useEffect(() => {
    if (!focusedPostId) return;
    // Drop the query string so a refresh doesn't keep re-opening it.
    const cleanup = window.setTimeout(() => {
      navigate(routerLocation.pathname, { replace: true });
    }, 1500);
    return () => window.clearTimeout(cleanup);
  }, [focusedPostId, navigate, routerLocation.pathname]);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [embedderReady, setEmbedderReady] = useState(
    getEmbeddingStatus().phase === "ready",
  );
  // Archive toggle: default collapsed so the main feed is focused on
  // "help needed now". Solved posts remain searchable regardless of
  // this flag — search is its own code path.
  const [showArchive, setShowArchive] = useState(false);

  const posts = useLiveQuery(
    () => db.posts.orderBy("created_at").reverse().toArray(),
    [],
    [],
  );

  useEffect(() => {
    return subscribeEmbeddingStatus((s) => setEmbedderReady(s.phase === "ready"));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void refreshFeed()
      .then(() => {
        if (!cancelled) setLastSyncedAt(Date.now());
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [setLastSyncedAt]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!posts || !query.trim()) {
        setHits(null);
        return;
      }
      if (embedderReady) {
        try {
          const ranked = await semanticRank(query, posts);
          if (!cancelled) setHits(ranked);
          return;
        } catch (err) {
          console.warn("[feed] semantic rank failed, falling back", err);
        }
      }
      if (!cancelled) setHits(keywordRank(query, posts));
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [query, posts, embedderReady]);

  const displayList: { post: Post; matched: boolean }[] = (() => {
    if (!posts) return [];
    if (!query.trim() || !hits) {
      return posts.map((post) => ({ post, matched: false }));
    }
    const cap = offline ? OFFLINE_MAX_RESULTS : undefined;
    const top = filterRelevantHits(hits, cap);
    if (top.length === 0) {
      // Nothing scores high enough to be confidently relevant — fall back to
      // exact keyword matches so the user always sees something if it's there.
      const kw = keywordRank(query, posts);
      const matches = kw
        .filter((h) => h.score > 0)
        .map((h) => ({ post: h.post, matched: true }));
      return offline ? matches.slice(0, OFFLINE_MAX_RESULTS) : matches;
    }
    return top.map((h) => ({ post: h.post, matched: true }));
  })();

  const showingResults = query.trim().length > 0;

  // Split the feed into active vs solved so resolved posts stop cluttering
  // the "help needed now" list. In search mode we leave the list intact so
  // someone looking up "grocery help" can still discover historical solves.
  // Resources (pharmacy hours etc.) are never resolvable so they always
  // land in the active bucket regardless of their `resolved_at` value.
  const activeList = showingResults
    ? displayList
    : displayList.filter(({ post }) => !post.resolved_at);
  const archivedList = showingResults
    ? []
    : displayList.filter(({ post }) => !!post.resolved_at);

  return (
    <section className="space-y-4">
      {!showingResults && (
        <button
          type="button"
          onClick={() => navigate("/listen")}
          className="w-full flex items-center gap-4 rounded-2xl border-2 border-primary/30 bg-primary/10 p-4 text-start shadow-soft motion-safe:active:scale-[0.99] transition-transform"
        >
          <span
            aria-hidden
            className="size-14 shrink-0 rounded-full bg-primary text-primary-foreground grid place-items-center"
          >
            <Mic className="size-7" />
          </span>
          <span className="flex-1">
            <span className="block font-bold text-lg leading-tight">
              {t("listen.heroTitle")}
            </span>
            <span className="block text-sm text-muted-foreground mt-1 leading-snug">
              {t("listen.heroHint")}
            </span>
          </span>
        </button>
      )}

      <SearchBar />

      <header className="flex items-center justify-between">
        <h1>
          {showingResults ? t("search.resultsTitle") : t("feed.title")}
        </h1>
        {loading && <Loader2 className="size-6 motion-safe:animate-spin text-primary" aria-hidden />}
      </header>

      {showingResults && displayList.length > 0 && (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Sparkles className="size-4 text-primary" aria-hidden />
          {embedderReady
            ? t("search.smartResults", { count: displayList.length })
            : t("search.keywordResults", { count: displayList.length })}
        </p>
      )}

      {showingResults && activeList.length === 0 && (
        <AskCommunityCard query={query} variant="empty" />
      )}

      {showingResults && activeList.length > 0 && offline && (
        <div
          className="flex items-start gap-3 rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 p-4"
          role="note"
        >
          <Wifi className="size-5 text-primary mt-0.5 shrink-0" aria-hidden />
          <div className="flex-1 text-sm">
            <p className="font-bold text-ink">
              {t("search.offlineNudge.title")}
            </p>
            <p className="text-muted-foreground mt-1">
              {t("search.offlineNudge.body")}
            </p>
          </div>
        </div>
      )}

      {showingResults && activeList.length > 0 && !offline && (
        <AskCommunityCard query={query} variant="followup" />
      )}

      {!showingResults &&
        posts &&
        posts.length > 0 &&
        activeList.length === 0 &&
        archivedList.length > 0 &&
        !loading && (
          <p className="text-muted-foreground">{t("feed.allSolved")}</p>
        )}

      {!showingResults && posts && posts.length === 0 && !loading && (
        <p className="text-muted-foreground">{t("feed.empty")}</p>
      )}

      <div className="space-y-4">
        {activeList.map(({ post, matched }) => (
          <PostCard
            key={post.id}
            post={post}
            highlighted={matched}
            defaultThreadOpen={focusedPostId === post.id}
          />
        ))}
      </div>

      {/* Archive: collapsed by default so the feed reads as "active help
          needed". Button doubles as the section header when expanded so
          there's only one way to close it — avoids the usual "was the X
          a close button or a back button?" confusion for elderly users. */}
      {!showingResults && archivedList.length > 0 && (
        <div className="pt-4 space-y-3">
          <button
            type="button"
            onClick={() => setShowArchive((v) => !v)}
            aria-expanded={showArchive}
            aria-controls="feed-archive-list"
            className="w-full flex items-center gap-3 rounded-2xl border border-border bg-white px-4 py-3 min-h-touch text-start hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40 transition-colors"
          >
            <span
              className="shrink-0 size-10 rounded-full bg-emerald-100 text-emerald-700 grid place-items-center"
              aria-hidden
            >
              <CheckCircle2 className="size-5" />
            </span>
            <span className="flex-1 font-bold text-base">
              {t("feed.archive.toggle", { count: archivedList.length })}
            </span>
            {showArchive ? (
              <ChevronUp className="size-5 text-muted-foreground" aria-hidden />
            ) : (
              <ChevronDown className="size-5 text-muted-foreground" aria-hidden />
            )}
          </button>
          {showArchive && (
            <div id="feed-archive-list" className="space-y-4">
              {archivedList.map(({ post, matched }) => (
                <PostCard
                  key={post.id}
                  post={post}
                  highlighted={matched}
                  defaultThreadOpen={focusedPostId === post.id}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
