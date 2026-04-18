import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { SUPPORTED_LANGUAGES, type Language } from "@/i18n";
import { cn } from "@/lib/utils";

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
  const [name, setName] = useState(user.name);
  const [emoji, setEmoji] = useState(user.emoji);
  const [saved, setSaved] = useState(false);

  const save = () => {
    setUser({ name, emoji });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <section className="space-y-6">
      <h1>{t("settings.title")}</h1>

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
          <div className="grid grid-cols-6 gap-2">
            {EMOJI_CHOICES.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setEmoji(e)}
                aria-pressed={emoji === e}
                className={cn(
                  "text-3xl rounded-2xl min-h-touch grid place-items-center border-2",
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
