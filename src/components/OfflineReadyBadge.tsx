import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import {
  getEmbeddingStatus,
  subscribeEmbeddingStatus,
  type EmbeddingStatus,
} from "@/lib/embeddings";
import { cn } from "@/lib/utils";

/**
 * Compact status pill showing whether the offline search index
 * (embedding model) has finished downloading + initialising.
 */
export default function OfflineReadyBadge({ className }: { className?: string }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<EmbeddingStatus>(getEmbeddingStatus());

  useEffect(() => subscribeEmbeddingStatus(setStatus), []);

  let icon: React.ReactNode;
  let label: string;
  let tone: string;

  switch (status.phase) {
    case "ready":
      icon = <CheckCircle2 className="size-4" aria-hidden />;
      label = t("settings.offlinePackReady");
      tone = "bg-success/15 text-success border-success/30";
      break;
    case "loading":
      icon = <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />;
      label = t("settings.offlinePackDownloadingPct", {
        progress: Math.round(status.progress),
      });
      tone = "bg-primary/10 text-primary border-primary/30";
      break;
    case "error":
      icon = <AlertCircle className="size-4" aria-hidden />;
      label = t("settings.offlinePackError");
      tone = "bg-offline/20 text-ink border-offline/40";
      break;
    default:
      icon = <Loader2 className="size-4" aria-hidden />;
      label = t("settings.offlinePackDownloading");
      tone = "bg-muted text-ink border-border";
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-bold",
        tone,
        className,
      )}
      role="status"
    >
      {icon}
      <span>{label}</span>
    </div>
  );
}
