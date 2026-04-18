import { GoogleGenerativeAI } from "@google/generative-ai";
import { db } from "./db";
import type { Category, Translations } from "./types";

const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

export interface TranslateResult {
  translations: Translations;
  suggestedCategory?: Category;
  simplified?: string;
}

const SYSTEM_PROMPT = `You are a helpful translator for a Slovak community help app called OmniBridge.
You receive a short Slovak post (request for help, offer, or a resource announcement) and must return ONLY a JSON object with this exact shape:

{
  "en": "English translation, clear and simple, under 200 chars",
  "ar": "Arabic translation, clear and simple",
  "uk": "Ukrainian translation, clear and simple",
  "category": "one of: help | food | medical | ride | legal | resource | tech | other",
  "simplified": "a simplified Slovak version in very plain language for older users"
}

Rules:
- Output ONLY valid JSON, no markdown, no prose, no code fences.
- Preserve phone numbers and addresses exactly.
- Keep translations concise and direct (elderly and low-literacy users read this).
- Choose the single best category.`;

function cacheKey(text: string) {
  return `sk:${text.trim().toLowerCase()}`;
}

/**
 * Translate a Slovak post into { en, ar, uk } and suggest a category.
 * Caches results in Dexie, so offline reads return the same payload.
 * If the Gemini key is missing or the call fails, returns an empty translations
 * object so the app still works (fallback to Slovak-only).
 */
export async function translatePost(slovakText: string): Promise<TranslateResult> {
  const text = slovakText.trim();
  if (!text) return { translations: {} };

  const key = cacheKey(text);
  const cached = await db.translations.get(key);
  if (cached) {
    return {
      translations: cached.translations,
      suggestedCategory: cached.suggestedCategory as Category | undefined,
    };
  }

  if (!genAI) {
    return { translations: {} };
  }

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2,
      },
    });

    const resp = await model.generateContent(text);
    const raw = resp.response.text();
    const parsed = JSON.parse(raw) as {
      en?: string;
      ar?: string;
      uk?: string;
      category?: string;
      simplified?: string;
    };

    const result: TranslateResult = {
      translations: {
        en: parsed.en,
        ar: parsed.ar,
        uk: parsed.uk,
      },
      suggestedCategory: parsed.category as Category | undefined,
      simplified: parsed.simplified,
    };

    await db.translations.put({
      key,
      sourceLang: "sk",
      text,
      translations: result.translations,
      suggestedCategory: result.suggestedCategory,
      cached_at: new Date().toISOString(),
    });

    return result;
  } catch (err) {
    console.warn("[translate] Gemini call failed:", err);
    return { translations: {} };
  }
}

/**
 * Batched variant that returns one result per input Slovak string,
 * preserving order. Useful for hydrating legacy rows that lack translations.
 */
export async function translateBatch(
  slovakTexts: string[],
): Promise<TranslateResult[]> {
  return Promise.all(slovakTexts.map(translatePost));
}
