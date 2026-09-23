import crypto from "node:crypto";
import type { NextRequest } from "next/server";

export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** 22-char URL-safe token. Valid as a Telegram deep-link payload ([A-Za-z0-9_-], ≤64). */
export function randomToken(bytes = 16): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function clientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim() || null;
  return request.headers.get("x-real-ip");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function hoursSince(iso: string | null | undefined): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

export function localHour(timezone: string, date = new Date()): number {
  const hour = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: timezone }).format(date);
  return Number(hour) % 24;
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + "…";
}

/** Run async jobs with a concurrency limit; never rejects, returns settled results. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { status: "fulfilled", value: await fn(items[index]!) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function isAuthorizedCron(request: NextRequest, cronSecret: string, setupSecret: string): boolean {
  const auth = request.headers.get("authorization");
  if (auth && safeEqual(auth, `Bearer ${cronSecret}`)) return true;
  // Manual trigger / external scheduler (Supabase pg_cron, cron-job.org ...).
  const header = request.headers.get("x-setup-secret");
  const query = request.nextUrl.searchParams.get("secret");
  return safeEqual(header, setupSecret) || safeEqual(query, setupSecret) || safeEqual(query, cronSecret);
}
