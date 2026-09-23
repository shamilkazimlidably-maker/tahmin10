import { loadSettings } from "@/src/lib/settings";
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/src/lib/env";
import { isAuthorizedCron } from "@/src/lib/util";
import { runFollowups } from "@/src/sales/followups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const env = getEnv();
  if (!isAuthorizedCron(request, env.CRON_SECRET, env.SETUP_SECRET)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await loadSettings(true);
  const result = await runFollowups({ force: request.nextUrl.searchParams.get("force") === "1" });
  return NextResponse.json({ ok: true, ...result });
}
