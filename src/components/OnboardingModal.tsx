import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Heart, Mic, MicOff, Sparkles } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { SUPPORTED_LANGUAGES, type Language } from "@/i18n";
import {
  startListening,
  voiceInputSupported,
  localeToBcp47,
  type VoiceSession,
} from "@/lib/voice";
import HelperPrefsEditor from "./HelperPrefsEditor";

/**
 * Welcome screen shown on a fresh install (whenever the user has not yet
 * chosen a name). It asks for:
 *   1. Language — a big 4-button picker that switches the rest of the UI
 *      immediately, so steps 2+ render in the chosen tongue.
 *   2. Display name — plus a random emoji they can reroll.
 *
 * Once saved, we persist to Zustand (which is localStorage-backed) and the
 * modal disappears forever. No "Skip" button — a name is required so posts
 * and replies look human, not anonymous.
 */

const EMOJI_POOL = [
  "🌻",
  "🐻",
  "🦉",
  "🦊",
  "🌳",
  "⭐",
  "🫖",
  "🐝",
  "🌸",
  "🐙",
  "🦋",
  "🍀",
  "🦒",
  "🐢",
  "🌈",
  "🌺",
];

function pickEmoji(current: string): string {
  const pool = EMOJI_POOL.filter((e) => e !== current);
  return pool[Math.floor(Math.random() * pool.length)] ?? current;
}

const LANGUAGE_NATIVE: Record<Language, { label: string; flag: string }> = {
  sk: { label: "Slovenčina", flag: "🇸🇰" },
  en: { label: "English", flag: "🇬🇧" },
  ar: { label: "العربية", flag: "🇸🇦" },
  uk: { label: "Українська", flag: "🇺🇦" },
};

export default function OnboardingModal() {
  const { t, i18n } = useTranslation();
  const user = useAppStore((s) => s.user);
  const setUser = useAppStore((s) => s.setUser);
  const language = useAppStore((s) => s.language);
  const setLanguage = useAppStore((s) => s.setLanguage);
  const helper = useAppStore((s) => s.helper);
  const setHelper = useAppStore((s) => s.setHelper);
  const helperOnboarded = useAppStore((s) => s.helperOnboarded);
  const setHelperOnboarded = useAppStore((s) => s.setHelperOnboarded);

  // Two-step flow:
  //   "name"   — existing welcome card (language + name + voice). Always shown
  //              when the user has no name yet.
  //   "helper" — new volunteer-matching card. Shown on a first run (after
  //              name is saved) OR for returning users who never saw it yet.
  //              Skippable — a "Not today" button just marks it seen.
  const needsName = !user.name;
  const needsHelperStep = !helperOnboarded;
  const visible = needsName || needsHelperStep;

  const [step, setStep] = useState<"name" | "helper">(needsName ? "name" : "helper");

  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState<string>(() => user.emoji || pickEmoji(""));
  const [listening, setListening] = useState(false);
  const voiceSessionRef = useRef<VoiceSession | null>(null);
  const canUseVoice = voiceInputSupported();

  // Local draft for step 2. Seeded from the persisted helper prefs so a user
  // who partially completed a previous session (or opted in via Settings)
  // sees their choices pre-ticked.
  const [helperTags, setHelperTags] = useState(helper.helperTags);
  const [availability, setAvailability] = useState(helper.availability);

  // Keep i18next in sync if the user switches languages mid-onboarding.
  useEffect(() => {
    if (i18n.language !== language) void i18n.changeLanguage(language);
  }, [language, i18n]);

  // If the user switches language while we're listening, restart the
  // recognition session with the new BCP-47 locale so the transcript is
  // correct. Stopping is enough — the toggle handler below owns starting.
  useEffect(() => {
    if (listening) {
      voiceSessionRef.current?.stop();
      setListening(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  // Always release the mic when the modal unmounts.
  useEffect(() => {
    return () => voiceSessionRef.current?.stop();
  }, []);

  const canSubmit = useMemo(() => name.trim().length >= 1, [name]);

  const toggleVoice = () => {
    if (listening) {
      voiceSessionRef.current?.stop();
      setListening(false);
      return;
    }
    if (!canUseVoice) return;
    setListening(true);
    voiceSessionRef.current = startListening({
      lang: localeToBcp47(language),
      onTranscript: (transcript, isFinal) => {
        // Names are typically one or two words — take only the first line
        // and trim the period/punctuation some recognizers append.
        const clean = transcript.replace(/[.。!?]+\s*$/u, "").trim();
        setName(clean);
        if (isFinal) setListening(false);
      },
      onError: () => setListening(false),
      onEnd: () => setListening(false),
    });
  };

  const submitName = () => {
    voiceSessionRef.current?.stop();
    const trimmed = name.trim();
    if (!trimmed) return;
    setUser({ name: trimmed, emoji });
    // Advance to the helper step next render. If they already saw it once
    // (unlikely on fresh name capture), skip straight to closed.
    setStep("helper");
  };

  const saveHelper = () => {
    const enabled = helperTags.length > 0 || Object.keys(availability).length > 0;
    setHelper({
      helperEnabled: enabled,
      helperTags,
      availability,
    });
    setHelperOnboarded(true);
  };

  const skipHelper = () => {
    setHelperOnboarded(true);
  };

  const backToName = () => {
    // Only meaningful when we're in "helper" but came from "name" in this
    // same session — we don't persist step history, so this just lets the
    // user tweak their name before saving helper prefs.
    setStep("name");
  };

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm px-3 py-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div className="w-full max-w-md rounded-3xl bg-surface shadow-soft-lg p-6 space-y-5 max-h-[92vh] overflow-y-auto">
        {step === "name" && (
          <>
            <header className="text-center space-y-2">
              <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                <Sparkles className="w-6 h-6" aria-hidden="true" />
              </div>
              <h2 id="onboarding-title" className="text-xl font-semibold text-ink">
                {t("onboarding.title")}
              </h2>
              <p className="text-sm text-ink/70">{t("onboarding.subtitle")}</p>
            </header>

            <section className="space-y-2">
              <label className="text-sm font-medium text-ink">
                {t("onboarding.languageLabel")}
              </label>
              <div className="grid grid-cols-2 gap-2">
                {SUPPORTED_LANGUAGES.map((lng) => {
                  const meta = LANGUAGE_NATIVE[lng];
                  const selected = language === lng;
                  return (
                    <button
                      key={lng}
                      type="button"
                      onClick={() => setLanguage(lng)}
                      className={`rounded-2xl border px-3 py-3 text-left flex items-center gap-2 transition ${
                        selected
                          ? "border-primary bg-primary/10 text-ink"
                          : "border-border bg-surface text-ink/80 hover:border-ink/30"
                      }`}
                    >
                      <span className="text-2xl leading-none" aria-hidden="true">
                        {meta.flag}
                      </span>
                      <span className="font-medium">{meta.label}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="space-y-2">
              <label
                htmlFor="onboarding-name"
                className="text-sm font-medium text-ink"
              >
                {t("onboarding.nameLabel")}
              </label>
              <div className="flex items-stretch gap-2">
                <button
                  type="button"
                  onClick={() => setEmoji((cur) => pickEmoji(cur))}
                  className="w-14 rounded-2xl border border-border bg-muted text-3xl flex items-center justify-center hover:bg-muted/70"
                  aria-label={t("onboarding.rerollEmoji") ?? "Change emoji"}
                  title={t("onboarding.rerollEmoji") ?? "Change emoji"}
                >
                  {emoji}
                </button>
                <input
                  id="onboarding-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("onboarding.namePlaceholder") ?? ""}
                  autoFocus
                  lang={localeToBcp47(language)}
                  aria-describedby="onboarding-name-hint"
                  className="flex-1 rounded-2xl border border-border bg-surface px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canSubmit) submitName();
                  }}
                />
                {canUseVoice && (
                  <button
                    type="button"
                    onClick={toggleVoice}
                    aria-pressed={listening}
                    aria-label={
                      listening
                        ? (t("onboarding.stopVoice") ?? "Stop listening")
                        : (t("onboarding.voiceName") ?? "Speak your name")
                    }
                    title={
                      listening
                        ? (t("onboarding.stopVoice") ?? "Stop listening")
                        : (t("onboarding.voiceName") ?? "Speak your name")
                    }
                    className={`w-14 min-h-touch rounded-2xl border flex items-center justify-center transition ${
                      listening
                        ? "border-primary bg-primary text-primary-foreground motion-safe:animate-pulse"
                        : "border-border bg-surface text-ink hover:bg-muted"
                    }`}
                  >
                    {listening ? (
                      <MicOff className="w-6 h-6" aria-hidden="true" />
                    ) : (
                      <Mic className="w-6 h-6" aria-hidden="true" />
                    )}
                  </button>
                )}
              </div>
              <p id="onboarding-name-hint" className="text-sm text-muted-foreground">
                {t("onboarding.nameHint")}
              </p>
              {listening && (
                <p
                  className="text-sm text-primary font-semibold"
                  role="status"
                  aria-live="polite"
                >
                  {t("onboarding.listening")}
                </p>
              )}
            </section>

            <button
              type="button"
              onClick={submitName}
              disabled={!canSubmit}
              className="w-full rounded-2xl bg-primary text-primary-foreground font-medium py-3 shadow-soft transition disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
            >
              {t("onboarding.continue")}
            </button>
          </>
        )}

        {step === "helper" && (
          <>
            <header className="text-center space-y-2">
              <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                <Heart className="w-6 h-6" aria-hidden="true" />
              </div>
              <h2 id="onboarding-title" className="text-xl font-semibold text-ink">
                {t("onboarding.helper.title")}
              </h2>
              <p className="text-sm text-ink/70">
                {t("onboarding.helper.subtitle")}
              </p>
            </header>

            <HelperPrefsEditor
              tags={helperTags}
              onTagsChange={setHelperTags}
              availability={availability}
              onAvailabilityChange={setAvailability}
            />

            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                onClick={saveHelper}
                className="w-full rounded-2xl bg-primary text-primary-foreground font-medium py-3 shadow-soft transition hover:opacity-90"
              >
                {t("onboarding.helper.save")}
              </button>
              <button
                type="button"
                onClick={skipHelper}
                className="w-full rounded-2xl border border-border bg-surface text-ink/80 font-medium py-3 hover:bg-muted"
              >
                {t("onboarding.helper.skip")}
              </button>
              {!needsName && (
                <button
                  type="button"
                  onClick={backToName}
                  className="w-full text-sm text-muted-foreground underline underline-offset-4 py-1"
                >
                  {t("onboarding.helper.back")}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
