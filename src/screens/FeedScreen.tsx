import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { db } from "@/lib/db";
import { refreshFeed } from "@/lib/posts";
import { useAppStore } from "@/store/useAppStore";
import PostCard from "@/components/PostCard";

export default function FeedScreen() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const setLastSyncedAt = useAppStore((s) => s.setLastSyncedAt);

  const posts = useLiveQuery(
    () => db.posts.orderBy("created_at").reverse().toArray(),
    [],
    [],
  );

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

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between">
        <h1>{t("feed.title")}</h1>
        {loading && <Loader2 className="size-6 animate-spin text-primary" aria-hidden />}
      </header>

      {posts && posts.length === 0 && !loading && (
        <p className="text-muted-foreground">{t("feed.empty")}</p>
      )}

      <div className="space-y-4">
        {posts?.map((post) => <PostCard key={post.id} post={post} />)}
      </div>
    </section>
  );
}
