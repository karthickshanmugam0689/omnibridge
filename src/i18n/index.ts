import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import sk from "./locales/sk.json";
import en from "./locales/en.json";
import ar from "./locales/ar.json";
import uk from "./locales/uk.json";

export const SUPPORTED_LANGUAGES = ["sk", "en", "ar", "uk"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const RTL_LANGUAGES: Language[] = ["ar"];

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      sk: { translation: sk },
      en: { translation: en },
      ar: { translation: ar },
      uk: { translation: uk },
    },
    fallbackLng: "sk",
    supportedLngs: SUPPORTED_LANGUAGES,
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "omnibridge.lang",
    },
  });

function applyDir(lng: string) {
  const dir = RTL_LANGUAGES.includes(lng as Language) ? "rtl" : "ltr";
  document.documentElement.setAttribute("dir", dir);
  document.documentElement.setAttribute("lang", lng);
}

applyDir(i18n.language || "sk");
i18n.on("languageChanged", applyDir);

export default i18n;
