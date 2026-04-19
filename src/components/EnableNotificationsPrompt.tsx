import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell, BellOff, Check, Loader2, AlertTriangle } from "lucide-react";
import {
  getPushStatus,
  subscribeToPush,
  pushSupported,
  type PushReason,
  type PushStatus,
} from "@/lib/push";
import { cn } from "@/lib/utils";

interface EnableNotificationsPromptProps {
  /** Called after the user accepts, declines, or the prompt is dismissed. */
  onDone?: () => void;
  /** Render style: full card (post-submit) or compact (settings list). */
  variant?: "card" | "compact";
}

/**
 * Friendly, opinionated permission prompt for Web Push.
 *
 * Important UX: we deliberately *don't* call `Notification.requestPermission()`
 * on mount — the browser dialog will get auto-blocked by Chrome's "abusive
 * notifications" heuristic if we do. Instead we show our own card asking the
 * user to confirm, and only call the native API when they tap "Yes".
 *
 * `variant="compact"` is used by the Settings screen, which renders a small
 * status row instead of the full headline card.
 */
export default function EnableNotificationsPrompt({
  onDone,
  variant = "card",
}: EnableNotificationsPromptProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [subscribedJustNow, setSubscribedJustNow] = useState(false);

  useEffect(() => {
    if (!pushSupported()) {
      setStatus({ subscribed: false, permission: "default", reason: "unsupported" });
      return;
    }
    void getPushStatus().then(setStatus);
  }, []);

  const accept = async () => {
    setBusy(true);
    try {
      const result = await subscribeToPush();
      setStatus(result.status);
      if (result.status.subscribed) {
        setSubscribedJustNow(true);
        // Give the user a moment to see the success state before dismissing.
        window.setTimeout(() => onDone?.(), 1200);
      }
    } finally {
      setBusy(false);
    }
  };

  const decline = () => {
    onDone?.();
  };

  if (!status) return null;

  const reason: PushReason = status.reason;
  const ok = status.subscribed;

  if (variant === "compact") {
    const label =
      ok ? t("notifications.statusOn")
      : reason === "denied" ? t("notifications.statusBlocked")
      : reason === "unsupported" ? t("notifications.statusUnsupported")
      : reason === "ios-needs-install" ? t("notifications.statusInstallNeeded")
      : reason === "missing-vapid" ? t("notifications.statusMissingKey")
      : t("notifications.statusOff");
    const tone =
      ok ? "bg-secondary/10 text-secondary border-secondary/20"
      : reason === "denied" || reason === "missing-vapid"
        ? "bg-destructive/10 text-destructive border-destructive/20"
        : "bg-muted text-muted-foreground border-border";
    return (
      <div className={cn("flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm", tone)}>
        <span className="inline-flex items-center gap-2">
          {ok ? <Bell className="size-4" aria-hidden /> : <BellOff className="size-4" aria-hidden />}
          {label}
        </span>
        {!ok && reason !== "denied" && reason !== "unsupported" && reason !== "missing-vapid" && (
          <button
            type="button"
            onClick={accept}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-white px-3 py-1.5 font-semibold disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 motion-safe:animate-spin" /> : <Bell className="size-4" />}
            {t("notifications.enable")}
          </button>
        )}
      </div>
    );
  }

  if (subscribedJustNow) {
    return (
      <div className="card border-2 border-secondary/30 bg-secondary/5 space-y-2">
        <div className="flex items-center gap-3 font-bold">
          <Check className="size-6 text-secondary" aria-hidden />
          {t("notifications.successTitle")}
        </div>
        <p className="text-sm text-muted-foreground">{t("notifications.successBody")}</p>
      </div>
    );
  }

  if (reason === "unsupported" || reason === "missing-vapid") {
    return null; // Silently skip — nothing for the user to do.
  }

  if (reason === "denied") {
    return (
      <div className="card border-2 border-destructive/30 bg-destructive/5 space-y-2">
        <div className="flex items-center gap-3 font-bold">
          <AlertTriangle className="size-6 text-destructive" aria-hidden />
          {t("notifications.deniedTitle")}
        </div>
        <p className="text-sm text-muted-foreground">{t("notifications.deniedBody")}</p>
        <button type="button" onClick={decline} className="btn-ghost w-full">
          {t("notifications.dismiss")}
        </button>
      </div>
    );
  }

  if (reason === "ios-needs-install") {
    return (
      <div className="card border-2 border-primary/30 bg-primary/5 space-y-2">
        <div className="flex items-center gap-3 font-bold">
          <Bell className="size-6 text-primary" aria-hidden />
          {t("notifications.installTitle")}
        </div>
        <p className="text-sm text-muted-foreground">{t("notifications.installBody")}</p>
        <button type="button" onClick={decline} className="btn-ghost w-full">
          {t("notifications.dismiss")}
        </button>
      </div>
    );
  }

  return (
    <div className="card border-2 border-primary/30 bg-primary/5 space-y-3">
      <div className="flex items-start gap-3">
        <div
          className="text-3xl shrink-0 size-12 rounded-2xl bg-primary/10 grid place-items-center"
          aria-hidden
        >
          <Bell className="size-6 text-primary" />
        </div>
        <div className="flex-1">
          <h2 className="text-[20px] font-bold leading-snug">
            {t("notifications.askTitle")}
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            {t("notifications.askBody")}
          </p>
        </div>
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          onClick={accept}
          disabled={busy}
          className="btn-primary flex-1"
        >
          {busy ? <Loader2 className="size-5 motion-safe:animate-spin" /> : <Bell className="size-5" />}
          {t("notifications.askYes")}
        </button>
        <button
          type="button"
          onClick={decline}
          className="btn-ghost flex-1"
        >
          {t("notifications.askLater")}
        </button>
      </div>
    </div>
  );
}
