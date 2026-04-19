import { useEffect } from "react";
import { CheckCircle2, AlertCircle, X } from "lucide-react";

type ToastVariant = "success" | "error" | "info";

interface ToastBannerProps {
  message: string;
  variant?: ToastVariant;
  /** ms before auto-dismiss. 0 means "never" (user must dismiss). */
  duration?: number;
  onClose: () => void;
}

/**
 * Large, persistent toast used across the app. Replaces the earlier 12 px
 * chip-style confirmations that were hard for elderly users to notice or
 * read. Renders above the bottom nav, auto-dismisses after `duration` ms
 * (default 5 s — generous enough for slower reading), and always shows an
 * explicit close button so the user isn't rushed.
 */
export default function ToastBanner({
  message,
  variant = "success",
  duration = 5000,
  onClose,
}: ToastBannerProps) {
  useEffect(() => {
    if (!duration) return;
    const id = window.setTimeout(onClose, duration);
    return () => window.clearTimeout(id);
  }, [duration, onClose]);

  const Icon = variant === "error" ? AlertCircle : CheckCircle2;

  return (
    <div
      role="status"
      aria-live="polite"
      className="toast-banner"
    >
      <Icon className="size-6 shrink-0" aria-hidden />
      <span className="flex-1 leading-snug">{message}</span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="size-11 -me-2 grid place-items-center rounded-full hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/40"
      >
        <X className="size-5" aria-hidden />
      </button>
    </div>
  );
}
