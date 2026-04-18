import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { WifiOff } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { db } from "@/lib/db";

export default function OfflineBanner() {
  const { t } = useTranslation();
  const online = useAppStore((s) => s.online);
  const lastSyncedAt = useAppStore((s) => s.lastSyncedAt);
  const [outboxCount, setOutboxCount] = useState(0);

  useEffect(() => {
    let mounted = true;
    const poll = () => {
      void db.outbox.count().then((c) => {
        if (mounted) setOutboxCount(c);
      });
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [online]);

  if (online && outboxCount === 0) return null;

  const minutesAgo = lastSyncedAt
    ? Math.max(1, Math.round((Date.now() - lastSyncedAt) / 60_000))
    : null;
  const timeLabel = minutesAgo ? `${minutesAgo} min` : "—";

  return (
    <div
      className="w-full bg-offline/20 text-ink border-b border-offline/40 px-4 py-2 text-sm font-bold flex items-center justify-center gap-2"
      role="status"
    >
      <WifiOff className="size-4" aria-hidden />
      {!online && <span>{t("offline.banner", { time: timeLabel })}</span>}
      {online && outboxCount > 0 && (
        <span>{t("offline.outbox", { count: outboxCount })}</span>
      )}
    </div>
  );
}
