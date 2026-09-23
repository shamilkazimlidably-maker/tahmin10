import { db, must } from "../lib/supabase";
import { purgeVisits } from "../lib/visits";
import { notifyAdmin } from "../lib/admin";
import { mapLimit } from "../lib/util";
import { FUNNEL, LEARNING, RETENTION } from "../config/funnel";
import type { Lead } from "../lib/leads";
import { analyzeLead } from "./analyst";
import { runCoach, type CoachResult } from "./coach";
import { evaluateExperiments } from "./experiments";

export type LearningRunResult = {
  closedAsSilent: number;
  analyzed: number;
  analysisErrors: number;
  experimentNotes: string[];
  coach: CoachResult | { status: "error"; message: string };
  /** Rows deleted by the daily clean-up (null = supabase/support_and_cleanup.sql not run yet). */
  purged: Record<string, number> | null;
};

/**
 * 1. A conversation needs an ENDING before it can teach anything.
 *    Paid = won. Explicit "no" = lost (set live by the engine).
 *    Silent for N days without paying = lost / went_silent (set here).
 *    If the person writes again, the engine re-opens the lead.
 */
async function closeStaleLeads(): Promise<number> {
  const cutoff = new Date(Date.now() - FUNNEL.closeAsLostAfterSilentDays * 24 * 3600 * 1000).toISOString();
  const now = new Date().toISOString();
  const { data, error } = await db()
    .from("leads")
    .update({ outcome: "lost", outcome_reason: "went_silent", closed_at: now })
    .is("outcome", null)
    .is("merged_into", null)
    .eq("paid", false)
    .not("telegram_user_id", "is", null)
    .lt("updated_at", cutoff)
    .lt("created_at", cutoff)
    .select("id");
  if (error) {
    console.error("[learning] closeStaleLeads:", error.message);
    return 0;
  }
  return data?.length ?? 0;
}

/** 2. One analyst call per closed, not-yet-analysed conversation. */
async function analyzeClosedLeads(): Promise<{ analyzed: number; errors: number }> {
  const leads = must(
    await db()
      .from("leads")
      .select("*")
      .not("outcome", "is", null)
      .is("analyzed_at", null)
      .is("merged_into", null)
      .not("telegram_user_id", "is", null)
      .order("closed_at", { ascending: true })
      .limit(LEARNING.maxAnalysesPerRun),
    "learning.closedLeads",
  ) as Lead[];

  const results = await mapLimit(leads, 3, (lead) => analyzeLead(lead));
  const errors = results.filter((r) => r.status === "rejected");
  for (const e of errors) console.error("[learning] analysis failed:", (e as PromiseRejectedResult).reason);
  return { analyzed: results.length - errors.length, errors: errors.length };
}

async function dailyDigest(result: LearningRunResult): Promise<void> {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data, error } = await db().rpc("funnel_stats", { p_since: since });
  if (error || !data) return;
  const f = data as Record<string, number>;
  if (!f.landing_leads && !f.started_bot && !result.analyzed) return; // nothing happened, stay quiet

  const coach =
    result.coach.status === "waiting"
      ? `coach waiting (${result.coach.pending}/${result.coach.needed} analysed conversations)`
      : `coach: ${result.coach.status}`;

  await notifyAdmin(
    [
      "📊 TAHMİN10 — son 24 saatte gelenler",
      `Sitede düğmeye basan: ${f.landing_leads ?? 0}`,
      `Botu başlatan: ${f.started_bot ?? 0}`,
      `Cevap yazan: ${f.replied ?? 0}`,
      `Ücretsiz kanala giren: ${f.joined_free ?? 0}`,
      `VIP planlarını gören: ${f.saw_plans ?? 0}`,
      `Ödeme sayfasını açan: ${f.checkout ?? 0}`,
      `Satın alan: ${f.paid ?? 0} (₺${Number(f.revenue ?? 0).toFixed(2)})`,
      "",
      `Learning: closed ${result.closedAsSilent} silent, analysed ${result.analyzed}${result.analysisErrors ? ` (${result.analysisErrors} errors)` : ""}, ${coach}.`,
      "Komutlar: /stats /funnel /objections /proposals /experiments /help",
    ].join("\n"),
  );
}

/** Keeps the free 500 MB database small. Runs AFTER the analyses so nothing is deleted before it was learned from. */
export async function purgeOldData(): Promise<Record<string, number> | null> {
  const { data, error } = await db().rpc("purge_old_data", { p_message_days: RETENTION.messageDays, p_event_days: RETENTION.eventDays });
  if (error) {
    console.error("[cleanup]", error.message, "— run supabase/support_and_cleanup.sql");
    return null;
  }
  return data as Record<string, number>;
}

export async function runLearningCycle(options: { forceCoach?: boolean; digest?: boolean } = {}): Promise<LearningRunResult> {
  const closedAsSilent = await closeStaleLeads();
  const { analyzed, errors } = await analyzeClosedLeads();

  let experimentNotes: string[] = [];
  try {
    experimentNotes = await evaluateExperiments();
  } catch (error) {
    console.error("[learning] experiments:", error);
  }

  let coach: LearningRunResult["coach"];
  try {
    coach = await runCoach({ force: options.forceCoach });
  } catch (error) {
    console.error("[learning] coach:", error);
    coach = { status: "error", message: (error as Error).message.slice(0, 300) };
  }

  await db().rpc("refresh_daily_stats", { p_days: 120 }).then((r) => r.error && console.error("[analytics]", r.error.message, "— run supabase/analytics.sql"));
  const purged = await purgeOldData();
  await purgeVisits(60).catch(() => 0);
  const result: LearningRunResult = { closedAsSilent, analyzed, analysisErrors: errors, experimentNotes, coach, purged };
  if (options.digest !== false) await dailyDigest(result).catch((e) => console.error("[learning] digest:", e));
  return result;
}
