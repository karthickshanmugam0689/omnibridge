import { pipeline, env, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { db, type StoredEmbedding } from "./db";
import type { Post } from "./types";

/**
 * On-device multilingual embeddings for offline semantic search.
 *
 * Model: `Xenova/multilingual-e5-small` — 50+ languages, 384-dim vectors,
 * ~120 MB quantized ONNX. Shared embedding space across Slovak / English /
 * Arabic / Ukrainian, so a query in any language retrieves posts in any
 * other language.
 *
 * After the first successful load the model is cached by the browser
 * (Cache Storage, keyed by URL). Subsequent page loads are instant and
 * fully offline.
 */

const MODEL_ID = "Xenova/multilingual-e5-small";

// Hugging Face JS runtime hints — prefer browser cache, never try to hit a
// local /models folder (which would 404 in dev).
env.allowLocalModels = false;
env.useBrowserCache = true;

export type EmbeddingStatus =
  | { phase: "idle" }
  | { phase: "loading"; progress: number; file?: string }
  | { phase: "ready" }
  | { phase: "error"; message: string };

type Listener = (status: EmbeddingStatus) => void;

let status: EmbeddingStatus = { phase: "idle" };
let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;
const listeners = new Set<Listener>();

export function getEmbeddingStatus(): EmbeddingStatus {
  return status;
}

export function subscribeEmbeddingStatus(listener: Listener): () => void {
  listeners.add(listener);
  listener(status);
  return () => listeners.delete(listener);
}

function setStatus(next: EmbeddingStatus) {
  status = next;
  for (const l of listeners) l(next);
}

/** Start downloading + initialising the embedding model. Safe to call many times. */
export function ensureEmbedder(): Promise<FeatureExtractionPipeline> {
  if (pipelinePromise) return pipelinePromise;
  setStatus({ phase: "loading", progress: 0 });
  pipelinePromise = pipeline("feature-extraction", MODEL_ID, {
    dtype: "q8",
    progress_callback: (p: unknown) => {
      const info = p as { status?: string; progress?: number; file?: string };
      if (
        (info?.status === "progress_total" || info?.status === "progress") &&
        typeof info.progress === "number"
      ) {
        setStatus({
          phase: "loading",
          progress: Math.max(0, Math.min(100, info.progress)),
          file: info.file,
        });
      }
    },
  })
    .then((pipe) => {
      setStatus({ phase: "ready" });
      return pipe as FeatureExtractionPipeline;
    })
    .catch((err: unknown) => {
      pipelinePromise = null;
      const message = err instanceof Error ? err.message : String(err);
      setStatus({ phase: "error", message });
      throw err;
    });
  return pipelinePromise;
}

/** Embed a single string. Returns a 384-length L2-normalised vector. */
export async function embed(text: string): Promise<number[]> {
  const pipe = await ensureEmbedder();
  const output = await pipe(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/** Cheap stable hash so we only re-embed a post when its text changes. */
function hash(str: string): string {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function postDocument(post: Post): string {
  const t = post.title_translations ?? {};
  const b = post.body_translations ?? {};
  return [
    post.title_sk,
    t.en,
    t.ar,
    t.uk,
    post.body_sk ?? "",
    b.en,
    b.ar,
    b.uk,
    post.location ?? "",
    post.category,
  ]
    .filter(Boolean)
    .join(" \n ");
}

export async function embedPost(post: Post): Promise<StoredEmbedding> {
  const doc = postDocument(post);
  const textHash = hash(doc);
  const existing = await db.embeddings.get(post.id);
  if (existing && existing.textHash === textHash) return existing;
  const vector = await embed(`passage: ${doc}`);
  const record: StoredEmbedding = {
    postId: post.id,
    vector,
    textHash,
    updatedAt: new Date().toISOString(),
  };
  await db.embeddings.put(record);
  return record;
}

/**
 * Embed any posts that are missing from the index, in the background.
 * Non-blocking — returns immediately; callers can await if they want.
 */
export async function buildMissingEmbeddings(): Promise<void> {
  const posts = await db.posts.toArray();
  if (posts.length === 0) return;
  await ensureEmbedder();
  for (const post of posts) {
    try {
      await embedPost(post);
    } catch (err) {
      console.warn("[embeddings] failed for post", post.id, err);
    }
  }
}

export interface SearchHit {
  post: Post;
  score: number;
}

/**
 * Filter a ranked hit list down to *only the genuinely relevant* matches.
 *
 * `multilingual-e5-small` tends to give moderately-high cosine similarity
 * (0.55–0.65) even to weak/unrelated posts, so a flat threshold either
 * shows noise (too low) or hides everything (too high). Instead we use:
 *
 *   - An absolute floor (`MIN_SCORE`) — anything below this is never relevant.
 *   - A **relative drop-off** from the top score — once results fall more than
 *     `RELATIVE_GAP` below the best match, they're noise compared to it.
 *   - A hard cap (`MAX_RESULTS`) so the user is never overwhelmed.
 *
 * Tuned by inspecting real query → score distributions on the seeded sample
 * data; bias is intentionally toward precision over recall, since the
 * "Ask the community" CTA gives the user a graceful escape hatch.
 */
const MIN_SCORE = 0.62;
const RELATIVE_GAP = 0.08;
const MAX_RESULTS = 6;

export function filterRelevantHits(
  hits: SearchHit[],
  maxResults: number = MAX_RESULTS,
): SearchHit[] {
  if (hits.length === 0) return hits;
  const top = hits[0].score;
  if (top < MIN_SCORE) return [];
  const cutoff = Math.max(MIN_SCORE, top - RELATIVE_GAP);
  return hits.filter((h) => h.score >= cutoff).slice(0, Math.max(1, maxResults));
}

/** Rank posts by similarity to a query. Returns all posts scored, descending. */
export async function semanticRank(query: string, posts: Post[]): Promise<SearchHit[]> {
  const q = query.trim();
  if (!q || posts.length === 0) {
    return posts.map((post) => ({ post, score: 0 }));
  }
  const queryVec = await embed(`query: ${q}`);
  const embeddings = await db.embeddings.bulkGet(posts.map((p) => p.id));
  return posts
    .map((post, i) => {
      const e = embeddings[i];
      const score = e ? cosine(queryVec, e.vector) : 0;
      return { post, score };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Substring-based fallback scorer — works instantly with no model, used
 * while the embedder is still downloading or on a device that can't run
 * it. Returns 0/1 scores so the UI can just filter by `score > 0` and
 * slice — same shape as `semanticRank` so the consumer doesn't care
 * which ranker produced the list.
 */
export function keywordRank(query: string, posts: Post[]): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return posts.map((post) => ({ post, score: 0 }));
  return posts
    .map((post) => {
      const hay = postDocument(post).toLowerCase();
      const score = hay.includes(q) ? 1 : 0;
      return { post, score };
    })
    .sort((a, b) => b.score - a.score);
}
