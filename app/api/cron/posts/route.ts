import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/src/lib/env";
import { loadSettings } from "@/src/lib/settings";
import { isAuthorizedCron } from "@/src/lib/util";
import { runDuePosts } from "@/src/sales/posts";

/** Her dakika Supabase pg_cron tarafından çağrılır (supabase/post_scheduler.sql): sırası gelen paylaşımları gönderir, 1 saati geçen içerikleri siler. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const env = getEnv();
  if (!isAuthorizedCron(request, env.CRON_SECRET, env.SETUP_SECRET)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await loadSettings();
  const result = await runDuePosts();
  return NextResponse.json({ ok: true, ...result });
}
