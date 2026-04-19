import { db } from "./db";
import { useAppStore } from "@/store/useAppStore";
import type { Category, SourceLang, Translations } from "./types";

/**
 * Symmetric translator: input can be in ANY of sk / en / ar / uk, and we
 * return strings for all four plus a category guess.
 *
 * Calls the `/api/translate` server proxy, which hides API keys and chooses
 * the upstream provider (Groq, Gemini, …). Results are cached in Dexie, so
 * repeated strings are free and work offline.
 *
 * If the proxy is unreachable (offline / no server configured) we return
 * empty translations — the app degrades to "source language only" for that
 * post and retries next time it's online. Offline *search* keeps working
 * because every seeded post and already-translated post lives on device.
 */

export interface TranslateResult {
  /** All four languages (any may be missing if the model skipped one). */
  translations: Translations;
  suggestedCategory?: Category;
  simplified?: string;
  provider: "groq" | "gemini" | "none";
}

interface ProxyResponse {
  sk?: string;
  en?: string;
  ar?: string;
  uk?: string;
  category?: string;
  simplified?: string;
  provider?: "groq" | "gemini" | "none";
}

function cacheKey(text: string, sourceLang?: SourceLang) {
  // Same text in the same source language → same translations. Mixing source
  // langs into the key prevents cross-contamination of cached translations.
  return `${sourceLang ?? "auto"}:${text.trim().toLowerCase()}`;
}

function hasAnyTranslation(t: Translations): boolean {
  return Boolean(t.sk || t.en || t.ar || t.uk);
}

async function callProxy(
  text: string,
  sourceLang?: SourceLang,
): Promise<ProxyResponse | null> {
  try {
    const resp = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, sourceLang }),
    });
    if (!resp.ok) return null;
    return (await resp.json()) as ProxyResponse;
  } catch (err) {
    console.warn("[translate] proxy unreachable:", err);
    return null;
  }
}

/**
 * Translate a short piece of text to every supported language.
 * `sourceLang` is an optional hint — the model also auto-detects.
 */
export async function translateAllLangs(
  text: string,
  sourceLang?: SourceLang,
): Promise<TranslateResult> {
  const trimmed = text.trim();
  if (!trimmed) return { translations: {}, provider: "none" };

  const key = cacheKey(trimmed, sourceLang);
  const cached = await db.translations.get(key);
  if (cached && hasAnyTranslation(cached.translations)) {
    return {
      translations: cached.translations,
      suggestedCategory: cached.suggestedCategory as Category | undefined,
      provider: "none",
    };
  }

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { translations: {}, provider: "none" };
  }
  // Respect the in-app "offline demo" toggle so judges can demo the offline
  // fallback without physically cutting the network.
  if (useAppStore.getState().offlineDemo) {
    return { translations: {}, provider: "none" };
  }

  const data = await callProxy(trimmed, sourceLang);
  if (!data) return { translations: {}, provider: "none" };

  const translations: Translations = {
    sk: data.sk,
    en: data.en,
    ar: data.ar,
    uk: data.uk,
  };

  const result: TranslateResult = {
    translations,
    suggestedCategory: data.category as Category | undefined,
    simplified: data.simplified,
    provider: data.provider ?? "none",
  };

  if (hasAnyTranslation(translations)) {
    await db.translations.put({
      key,
      sourceLang: sourceLang ?? "auto",
      text: trimmed,
      translations,
      suggestedCategory: result.suggestedCategory,
      cached_at: new Date().toISOString(),
    });
  }

  return result;
}

/**
 * Back-compat alias. The old name is kept so other modules (and anything
 * lingering in dev HMR) keep working while we phase in the symmetric API.
 * New code should call `translateAllLangs(text, sourceLang)`.
 */
export const translatePost = translateAllLangs;

/** Batched variant that preserves input order. */
export async function translateBatch(
  texts: string[],
  sourceLang?: SourceLang,
): Promise<TranslateResult[]> {
  return Promise.all(texts.map((t) => translateAllLangs(t, sourceLang)));
}
