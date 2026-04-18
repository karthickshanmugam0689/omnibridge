import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const hasSupabase = Boolean(url && anonKey);

if (!hasSupabase && import.meta.env.DEV) {
  console.warn(
    "[OmniBridge] Supabase env vars missing — running in local-only mode.",
  );
}

export const supabase = hasSupabase
  ? createClient(url, anonKey, {
      auth: { persistSession: false },
    })
  : null;
