import type { PushSubscription as WebPushSubscription } from "web-push";

/**
 * Push-subscription store with two backends:
 *
 *   1. **Supabase** (preferred on Vercel) — a `push_subscriptions` table keyed
 *      by endpoint. This survives serverless cold starts, so when teammate A
 *      replies to teammate B's post on a different device, the `/api/notify`
 *      function can still look up B's subscription.
 *
 *   2. **In-memory Map** (local dev / fallback) — used when the service-role
 *      env vars aren't set. Good enough when the whole dev server runs in a
 *      single process. Stashed on `globalThis` so it survives Vite HMR.
 *
 * Env vars (server-only — never expose to the browser):
 *   SUPABASE_URL               … project URL (same as VITE_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY  … service-role key (bypasses RLS; server use only)
 *
 * If only the public anon key is available we fall back to in-memory storage
 * because the browser policies on `push_subscriptions` are deny-by-default
 * (so we can never accidentally leak subscription endpoints client-side).
 */

export interface StoredSubscription {
  clientId: string;
  subscription: WebPushSubscription;
  createdAt: string;
}

// ── In-memory fallback ────────────────────────────────────────────────────
const GLOBAL_KEY = "__omnibridge_push_subs__";
interface GlobalWithSubs {
  [GLOBAL_KEY]?: Map<string, StoredSubscription[]>;
}
function memStore(): Map<string, StoredSubscription[]> {
  const g = globalThis as GlobalWithSubs;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new Map();
  return g[GLOBAL_KEY]!;
}

// ── Supabase lazy init ────────────────────────────────────────────────────
// We dynamic-import `@supabase/supabase-js` so the module loads cleanly even
// in environments where it's absent (e.g. Edge runtime tests).
type SupabaseClientLike = {
  from: (table: string) => {
    upsert: (row: Record<string, unknown>, opts?: Record<string, unknown>) => Promise<{ error: unknown }>;
    select: (cols: string) => { eq: (col: string, val: string) => Promise<{ data: unknown; error: unknown }> };
    delete: () => { eq: (col: string, val: string) => Promise<{ error: unknown }> };
  };
};

let supabaseClient: SupabaseClientLike | null | undefined;
async function getSupabase(): Promise<SupabaseClientLike | null> {
  if (supabaseClient !== undefined) return supabaseClient;
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !serviceKey) {
    supabaseClient = null;
    return null;
  }
  try {
    const mod = await import("@supabase/supabase-js");
    supabaseClient = mod.createClient(url, serviceKey, {
      auth: { persistSession: false },
    }) as unknown as SupabaseClientLike;
    return supabaseClient;
  } catch (err) {
    console.warn("[pushStore] supabase-js unavailable, using memory:", err);
    supabaseClient = null;
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────
export async function saveSubscription(
  clientId: string,
  subscription: WebPushSubscription,
): Promise<void> {
  const sb = await getSupabase();
  if (sb) {
    const { error } = await sb.from("push_subscriptions").upsert(
      {
        endpoint: subscription.endpoint,
        client_id: clientId,
        subscription,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" },
    );
    if (error) {
      console.warn("[pushStore] supabase upsert failed, falling back:", error);
    } else {
      return;
    }
  }
  const store = memStore();
  const list = store.get(clientId) ?? [];
  const filtered = list.filter((s) => s.subscription.endpoint !== subscription.endpoint);
  filtered.push({ clientId, subscription, createdAt: new Date().toISOString() });
  store.set(clientId, filtered);
}

export async function getSubscriptions(clientId: string): Promise<StoredSubscription[]> {
  const sb = await getSupabase();
  if (sb) {
    const { data, error } = await sb
      .from("push_subscriptions")
      .select("client_id, subscription, created_at")
      .eq("client_id", clientId);
    if (!error && Array.isArray(data)) {
      return (data as Array<{ client_id: string; subscription: WebPushSubscription; created_at: string }>).map(
        (row) => ({
          clientId: row.client_id,
          subscription: row.subscription,
          createdAt: row.created_at,
        }),
      );
    }
    if (error) console.warn("[pushStore] supabase select failed, falling back:", error);
  }
  return memStore().get(clientId) ?? [];
}

export async function removeSubscription(clientId: string, endpoint: string): Promise<void> {
  const sb = await getSupabase();
  if (sb) {
    const { error } = await sb.from("push_subscriptions").delete().eq("endpoint", endpoint);
    if (!error) return;
    console.warn("[pushStore] supabase delete failed, falling back:", error);
  }
  const store = memStore();
  const list = store.get(clientId);
  if (!list) return;
  const next = list.filter((s) => s.subscription.endpoint !== endpoint);
  if (next.length === 0) store.delete(clientId);
  else store.set(clientId, next);
}
