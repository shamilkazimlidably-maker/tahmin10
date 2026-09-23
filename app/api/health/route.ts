import { NextResponse, type NextRequest } from "next/server";
import { envProblems, getEnv } from "@/src/lib/env";
import { db } from "@/src/lib/supabase";
import { safeEqual } from "@/src/lib/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public: { ok }. With ?secret=SETUP_SECRET: names of the misconfigured variables (never values). */
export async function GET(request: NextRequest) {
  const problems = envProblems();
  let database = "skipped";
  if (!problems.length) {
    const { error } = await db().from("leads").select("id").limit(1);
    database = error ? `error: ${error.message}` : "ok";
  }
  const ok = problems.length === 0 && database === "ok";
  let detailed = false;
  try {
    detailed = safeEqual(request.nextUrl.searchParams.get("secret"), getEnv().SETUP_SECRET);
  } catch {
    // Env is broken, so the secret cannot be checked; show NAMES of the problems so the owner can fix them.
    detailed = true;
  }
  return NextResponse.json(detailed ? { ok, env: problems.length ? problems : "ok", database } : { ok }, { status: ok ? 200 : 503 });
}
