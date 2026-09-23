import { db } from "./supabase";

/**
 * Fixed-window rate limit stored in Postgres (works on serverless, no Redis).
 * Fails OPEN: if the database is unreachable we do not block real customers.
 */
export async function allowRequest(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  try {
    const { data, error } = await db().rpc("check_rate_limit", {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      console.error("[rate-limit]", error.message);
      return true;
    }
    return data !== false;
  } catch (error) {
    console.error("[rate-limit]", error);
    return true;
  }
}
