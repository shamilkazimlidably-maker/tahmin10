import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getEnv } from "./env";

let client: SupabaseClient | undefined;

/**
 * Server-only admin client. The secret key bypasses RLS, and every table
 * has RLS enabled with no policies, so the browser can never read your data.
 */
export function db(): SupabaseClient {
  if (client) return client;
  const env = getEnv();
  client = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { "x-application-name": "tahmin10" } },
  });
  return client;
}

/** Throws with context if a Supabase call failed. */
export function must<T>(result: { data: T; error: { message: string } | null }, context: string): T {
  if (result.error) throw new Error(`[db] ${context}: ${result.error.message}`);
  return result.data;
}
