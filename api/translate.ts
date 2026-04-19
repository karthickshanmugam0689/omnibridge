/**
 * Translate proxy — Vercel Edge Function.
 *
 * Hides API keys server-side and returns a stable JSON contract regardless
 * of which upstream provider is used. The client never knows which model
 * produced the translation.
 *
 * Provider order (auto fallback):
 *   1. Groq (free, very fast, Llama-based) — if GROQ_API_KEY is set
 *   2. Google Gemini 1.5 Flash             — if GEMINI_API_KEY is set
 *   3. Empty translations                  — always safe
 *
 * Symmetric translation: the input text may be in ANY of sk / en / ar / uk.
 * The model detects the source language and returns all four translations.
 * The client then re-attaches the original wording for the source language
 * (so "Slovak speaker writing Slovak" never gets their words paraphrased).
 *
 * Request body:   { text: string, sourceLang?: "sk" | "en" | "ar" | "uk" }
 * Response body:  { sk?, en?, ar?, uk?, category?, simplified?, provider: "groq" | "gemini" | "none" }
 */

export const config = { runtime: "edge" };

const SYSTEM_PROMPT = `You translate short community-help posts in OmniBridge, a neighbourhood app used by elderly Slovaks and refugees.

You will receive a single short message in Slovak, English, Arabic, or Ukrainian. DETECT the input language and return ONLY a JSON object with this exact shape and keys:

{
  "sk": "Slovak translation",
  "en": "English translation",
  "ar": "Arabic translation",
  "uk": "Ukrainian translation",
  "category": "one of: help | food | medical | ride | legal | resource | tech | other",
  "simplified": "a very plain, short Slovak version for older users"
}

Rules:
- Output ONLY valid JSON. No markdown, no prose, no code fences.
- Include ALL FOUR language fields (sk, en, ar, uk) even if the input is already in that language (in which case return it verbatim or lightly normalised).
- Keep each translation under 200 characters.
- Preserve phone numbers, addresses and proper nouns exactly.
- Use clear, direct, friendly wording suitable for older users and low-literacy readers.
- Choose the single best category.`;

interface TranslatePayload {
  sk?: string;
  en?: string;
  ar?: string;
  uk?: string;
  category?: string;
  simplified?: string;
}

interface TranslateResponse extends TranslatePayload {
  provider: "groq" | "gemini" | "none";
}

function tryParseJson(raw: string): TranslatePayload | null {
  try {
    return JSON.parse(raw) as TranslatePayload;
  } catch {
    // Some providers wrap JSON in ```json fences; strip and retry once.
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as TranslatePayload;
    } catch {
      return null;
    }
  }
}

async function callGroq(text: string, apiKey: string): Promise<TranslatePayload | null> {
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
    }),
  });
  if (!resp.ok) {
    console.warn("[translate] Groq failed:", resp.status, await resp.text());
    return null;
  }
  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content ?? "";
  return tryParseJson(raw);
}

async function callGemini(text: string, apiKey: string): Promise<TranslatePayload | null> {
  // Use the `-latest` alias so the proxy keeps working across Google's model
  // version retirements without us hard-coding a version that may be deprecated.
  const model = process.env.GEMINI_MODEL ?? "gemini-flash-latest";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { role: "system", parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2,
      },
    }),
  });
  if (!resp.ok) {
    console.warn("[translate] Gemini failed:", resp.status, await resp.text());
    return null;
  }
  const data = (await resp.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return tryParseJson(raw);
}

const EMPTY: TranslateResponse = { provider: "none" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: { text?: unknown; sourceLang?: unknown };
  try {
    body = (await req.json()) as { text?: unknown; sourceLang?: unknown };
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  // `sourceLang` is an optional hint. We accept it but don't hard-enforce —
  // the model detects the language anyway. Mainly useful as a tiebreaker
  // for ambiguous single-word inputs like "hotel".
  const sourceLang =
    typeof body.sourceLang === "string" && ["sk", "en", "ar", "uk"].includes(body.sourceLang)
      ? (body.sourceLang as "sk" | "en" | "ar" | "uk")
      : undefined;
  if (!text) {
    return new Response(JSON.stringify(EMPTY), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  // Prefix the hint onto the prompt content, so the model has it in-band.
  const userContent = sourceLang
    ? `Source language hint: ${sourceLang}. Text: ${text}`
    : text;

  if (groqKey) {
    const result = await callGroq(userContent, groqKey);
    if (result) {
      return Response.json({ ...result, provider: "groq" } satisfies TranslateResponse);
    }
  }

  if (geminiKey) {
    const result = await callGemini(userContent, geminiKey);
    if (result) {
      return Response.json({ ...result, provider: "gemini" } satisfies TranslateResponse);
    }
  }

  return Response.json(EMPTY);
}
