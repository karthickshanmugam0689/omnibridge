import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Heart, WifiOff, Type, Sparkles } from "lucide-react";
import { useAppStore, type FontScale } from "@/store/useAppStore";
import { SUPPORTED_LANGUAGES, type Language } from "@/i18n";
import { cn } from "@/lib/utils";
import OfflineReadyBadge from "@/components/OfflineReadyBadge";
import EnableNotificationsPrompt from "@/components/EnableNotificationsPrompt";
import HelperPrefsEditor from "@/components/HelperPrefsEditor";

const FONT_CHOICES: Array<{ id: FontScale; label: string; sample: string }> = [
  { id: "md", label: "A", sample: "text-base" },
  { id: "lg", label: "A", sample: "text-xl" },
  { id: "xl", label: "A", sample: "text-3xl" },
];

const LANG_LABELS: Record<Language, { native: string; flag: string }> = {
  sk: { native: "Slovenčina", flag: "🇸🇰" },
  en: { native: "English", flag: "🇬🇧" },
  ar: { native: "العربية", flag: "🇸🇦" },
  uk: { native: "Українська", flag: "🇺🇦" },
};

const EMOJI_CHOICES = ["🌻", "🐻", "🦉", "🦊", "🌳", "⭐", "🫖", "🐝", "🌸", "🐿️", "🍀", "🌈"];

export default function SettingsScreen() {
  const { t } = useTranslation();
  const { language, setLanguage, user, setUser } = useAppStore();
  const offlineDemo = useAppStore((s) => s.offlineDemo);
  const setOfflineDemo = useAppStore((s) => s.setOfflineDemo);
  const fontScale = useAppStore((s) => s.fontScale);
  const setFontScale = useAppStore((s) => s.setFontScale);
  const helper = useAppStore((s) => s.helper);
  const setHelper = useAppStore((s) => s.setHelper);
  // Server-authoritative thank-you total. We already pull this into the
  // store on app boot (`App.tsx` → `pullProfilePoints`). Re-rendering here
  // whenever it changes gives a satisfying live bump the moment a push
  // comes in from /api/resolve while the user is on the settings screen.
  const points = useAppStore((s) => s.points);
  const [name, setName] = useState(user.name);
  const [emoji, setEmoji] = useState(user.emoji);
  const [saved, setSaved] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  // Surface the OS-level "reduce motion" preference so users can see that
  // we're already honouring it. We never override it — Tailwind's
  // `motion-safe:` prefix handles the actual gating.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  const save = () => {
    setUser({ name, emoji });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <section className="space-y-6">
      <h1>{t("settings.title")}</h1>

      <div className="card space-y-4">
        <h2 className="text-[22px] flex items-center gap-2">
          <Type className="size-6 text-primary" aria-hidden />
          {t("settings.accessibility")}
        </h2>
        <div className="space-y-3">
          <p className="font-bold">{t("settings.fontSize")}</p>
          <p className="text-sm text-muted-foreground">
            {t("settings.fontSizeHint")}
          </p>
          <div
            role="radiogroup"
            aria-label={t("settings.fontSize")}
            className="grid grid-cols-3 gap-3"
          >
            {FONT_CHOICES.map((f) => (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={fontScale === f.id}
                onClick={() => setFontScale(f.id)}
                className={cn(
                  "rounded-2xl min-h-touch py-4 border-2 font-bold grid place-items-center",
                  fontScale === f.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-white text-ink hover:bg-muted",
                )}
              >
                <span className={f.sample}>{f.label}</span>
                <span className="sr-only">{t(`settings.fontSizeOption.${f.id}`)}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="border-t border-border pt-3">
          <p className="font-bold">{t("settings.reducedMotion")}</p>
          <p className="text-sm text-muted-foreground mt-1">
            {reducedMotion
              ? t("settings.reducedMotionOn")
              : t("settings.reducedMotionOff")}
          </p>
        </div>
      </div>

      <div className="card space-y-4">
        <h2 className="text-[22px]">{t("settings.offlineReady")}</h2>
        <OfflineReadyBadge />
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={offlineDemo}
            onChange={(e) => setOfflineDemo(e.target.checked)}
            className="size-5 mt-1 accent-primary"
          />
          <span>
            <span className="font-bold flex items-center gap-2">
              <WifiOff className="size-4" aria-hidden />
              {t("settings.offlineDemo")}
            </span>
            <span className="block text-sm text-muted-foreground mt-1">
              {t("settings.offlineDemoHint")}
            </span>
          </span>
        </label>
      </div>

      <div className="card space-y-3">
        <h2 className="text-[22px]">{t("notifications.sectionTitle")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("notifications.sectionHint")}
        </p>
        <EnableNotificationsPrompt variant="compact" />
      </div>

      <div className="card space-y-4">
        <h2 className="text-[22px] flex items-center gap-2">
          <Heart className="size-6 text-primary" aria-hidden />
          {t("settings.helper.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("settings.helper.hint")}
        </p>
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={helper.helperEnabled}
            onChange={(e) => setHelper({ helperEnabled: e.target.checked })}
            className="size-5 mt-1 accent-primary"
          />
          <span>
            <span className="font-bold">{t("settings.helper.enabled")}</span>
            <span className="block text-sm text-muted-foreground mt-1">
              {helper.helperEnabled
                ? t("settings.helper.enabledHintOn")
                : t("settings.helper.enabledHintOff")}
            </span>
          </span>
        </label>
        <div
          className={cn(
            "space-y-4 transition-opacity",
            !helper.helperEnabled && "opacity-50 pointer-events-none",
          )}
          aria-hidden={!helper.helperEnabled}
        >
          <HelperPrefsEditor
            tags={helper.helperTags}
            onTagsChange={(helperTags) => setHelper({ helperTags })}
            availability={helper.availability}
            onAvailabilityChange={(availability) => setHelper({ availability })}
          />
        </div>
      </div>

      <div className="card space-y-3 bg-gradient-to-br from-amber-50 to-white border-amber-200">
        <h2 className="text-[22px] flex items-center gap-2">
          <Sparkles className="size-6 text-amber-600" aria-hidden />
          {t("settings.points.title")}
        </h2>
        <div className="flex items-baseline gap-3">
          <span
            className="text-5xl font-black text-amber-700 tabular-nums"
            aria-live="polite"
          >
            {points}
          </span>
          <span className="text-lg text-amber-900 font-semibold">
            {t(points === 1 ? "settings.points.totalOne" : "settings.points.totalOther", {
              count: points,
            })}
          </span>
        </div>
        <p className="text-sm text-amber-900/80">
          {points === 0 ? t("settings.points.zeroHint") : t("settings.points.hint")}
        </p>
        {points >= 50 && (
          <p className="text-sm font-semibold text-amber-800">
            {t("settings.points.milestone")}
          </p>
        )}
      </div>

      <div className="card space-y-4">
        <h2 className="text-[22px]">{t("settings.language")}</h2>
        <div className="grid grid-cols-2 gap-3">
          {SUPPORTED_LANGUAGES.map((lng) => (
            <button
              key={lng}
              type="button"
              onClick={() => setLanguage(lng)}
              aria-pressed={language === lng}
              className={cn(
                "flex items-center gap-3 rounded-2xl p-4 border-2 min-h-touch text-left font-bold",
                language === lng
                  ? "border-primary bg-primary/5"
                  : "border-border bg-white",
              )}
            >
              <span className="text-2xl" aria-hidden>
                {LANG_LABELS[lng].flag}
              </span>
              <span>{LANG_LABELS[lng].native}</span>
              {language === lng && (
                <Check className="size-5 text-primary ms-auto" aria-hidden />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="card space-y-4">
        <h2 className="text-[22px]">{t("settings.profile")}</h2>
        <label className="block space-y-2">
          <span className="font-bold">{t("settings.yourName")}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("settings.namePlaceholder")}
            className="w-full rounded-2xl border border-border bg-white p-4 text-base focus-visible:ring-4 focus-visible:ring-primary/40 focus-visible:outline-none"
          />
        </label>
        <div className="space-y-2">
          <span className="font-bold">{t("settings.yourEmoji")}</span>
          <div className="grid grid-cols-4 gap-2">
            {EMOJI_CHOICES.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setEmoji(e)}
                aria-pressed={emoji === e}
                className={cn(
                  "text-3xl rounded-2xl min-h-touch py-3 grid place-items-center border-2",
                  emoji === e
                    ? "border-primary bg-primary/5"
                    : "border-border bg-white",
                )}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
        <button type="button" onClick={save} className="btn-primary w-full">
          {saved ? t("settings.saved") : t("settings.save")}
        </button>
      </div>

      <div className="card">
        <h2 className="text-[22px]">{t("settings.about")}</h2>
        <p className="mt-2 leading-relaxed text-muted-foreground">
          {t("settings.aboutText")}
        </p>
      </div>
    </section>
  );
}
