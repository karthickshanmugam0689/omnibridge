import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Languages, Check } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { SUPPORTED_LANGUAGES, type Language } from "@/i18n";
import { cn } from "@/lib/utils";

const LANG_LABELS: Record<Language, { native: string; flag: string }> = {
  sk: { native: "Slovenčina", flag: "🇸🇰" },
  en: { native: "English", flag: "🇬🇧" },
  ar: { native: "العربية", flag: "🇸🇦" },
  uk: { native: "Українська", flag: "🇺🇦" },
};

export default function TopBar() {
  const { t } = useTranslation();
  const language = useAppStore((s) => s.language);
  const setLanguage = useAppStore((s) => s.setLanguage);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = LANG_LABELS[language];

  return (
    <header className="sticky top-0 z-30 w-full bg-surface/90 backdrop-blur border-b border-border/60">
      <div className="max-w-2xl mx-auto px-4 h-16 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-bold">
          <span aria-hidden className="text-2xl">🌉</span>
          <span className="text-lg">{t("app.name")}</span>
        </div>

        <div className="relative" ref={containerRef}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={t("settings.language")}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-white px-4 min-h-touch text-base font-bold hover:bg-muted focus-visible:ring-4 focus-visible:ring-primary/40 focus-visible:outline-none"
          >
            <Languages className="size-5" aria-hidden />
            <span aria-hidden className="text-lg">{current.flag}</span>
            <span className="hidden sm:inline">{current.native}</span>
            <span className="sm:hidden uppercase">{language}</span>
          </button>

          {open && (
            <ul
              role="listbox"
              aria-label={t("settings.language")}
              className="absolute end-0 mt-2 w-60 rounded-2xl border border-border bg-white shadow-soft p-1 z-40"
            >
              {SUPPORTED_LANGUAGES.map((lng) => {
                const selected = lng === language;
                return (
                  <li key={lng}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        setLanguage(lng);
                        setOpen(false);
                      }}
                      className={cn(
                        "w-full flex items-center gap-3 rounded-xl px-3 min-h-touch text-left text-base font-bold",
                        selected ? "bg-primary/10 text-primary" : "hover:bg-muted",
                      )}
                    >
                      <span className="text-2xl" aria-hidden>
                        {LANG_LABELS[lng].flag}
                      </span>
                      <span className="flex-1">{LANG_LABELS[lng].native}</span>
                      {selected && <Check className="size-5" aria-hidden />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </header>
  );
}
