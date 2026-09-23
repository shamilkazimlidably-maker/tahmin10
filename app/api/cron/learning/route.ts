import { loadSettings } from "@/src/lib/settings";
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/src/lib/env";
import { isAuthorizedCron } from "@/src/lib/util";
import { runLearningCycle } from "@/src/learning/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const env = getEnv();
  if (!isAuthorizedCron(request, env.CRON_SECRET, env.SETUP_SECRET)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await loadSettings(true);
  const q = request.nextUrl.searchParams;
  const result = await runLearningCycle({ forceCoach: q.get("force") === "1", digest: q.get("digest") !== "0" });
  return NextResponse.json({ ok: true, ...result });
}
