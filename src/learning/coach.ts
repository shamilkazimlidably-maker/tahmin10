import { z } from "zod";
import { deepseekJson } from "../lib/deepseek";
import { getEnv } from "../lib/env";
import { INTEGRATION_OVERRIDES } from "../lib/integrations";
import { db, must } from "../lib/supabase";
import { notifyAdmin } from "../lib/admin";
import { COACH_PROMPT } from "../config/prompts";
import { LEARNING, type ExperimentMetric } from "../config/funnel";
import { getActivePlaybook, playbookContentSchema, savePlaybook, validateProposal } from "./playbook";
import { createExperiment, listExperiments } from "./experiments";

const coachSchema = z.object({
  summary: z.string().max(1500).catch(""),
  biggest_leak: z.string().max(80).catch("unknown"),
  changes: z
    .array(
      z.object({
        type: z.string().catch("none"),
        guideline_id: z.string().catch(""),
        reason: z.string().max(400).catch(""),
        evidence_count: z.coerce.number().catch(0),
      }),
    )
    .catch([]),
  playbook: playbookContentSchema.omit({ locked_winners: true }),
  experiment_proposals: z
    .array(
      z.object({
        slot: z.string(),
        name: z.string(),
        hypothesis: z.string().catch(""),
        metric: z.enum(["reply", "free_join", "vip_offer", "checkout", "purchase"]).catch("purchase"),
        variant_a: z.string().min(10),
        variant_b: z.string().min(10),
      }),
    )
    .max(2)
    .catch([]),
});

const OWNER_REVIEWS_NOTE = `

# owner_reviews
Ratings (1 = bad, 5 = excellent) and notes written by the BUSINESS OWNER after reading real conversations (usually in Turkish).
They are the strongest qualitative evidence you have: a complaint the owner repeats must be addressed before anything else — still inside the forbidden list and the change limit. Mention in "summary" how you used them.`;

export type CoachResult =
  | { status: "waiting"; pending: number; needed: number }
  | { status: "rejected"; problems: string[] }
  | { status: "unchanged"; summary: string }
  | { status: "proposed" | "activated"; version: number; summary: string };

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T | null> {
  const { data, error } = await db().rpc(name, args);
  if (error) {
    console.error(`[coach] rpc ${name}:`, error.message);
    return null;
  }
  return data as T;
}

export async function runCoach(options: { force?: boolean } = {}): Promise<CoachResult> {
  const pending = must(
    await db()
      .from("conversation_analyses")
      .select("*")
      .is("batch_id", null)
      .gt("user_messages", 0)
      .order("created_at", { ascending: true })
      .limit(60),
    "coach.pending",
  ) as Record<string, unknown>[];

  if (!options.force && pending.length < LEARNING.coachBatchSize) {
    return { status: "waiting", pending: pending.length, needed: LEARNING.coachBatchSize };
  }
  if (!pending.length) return { status: "waiting", pending: 0, needed: LEARNING.coachBatchSize };

  const since30 = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const [active, funnelAll, funnel30, byPlaybook, objections, experiments] = await Promise.all([
    getActivePlaybook(),
    rpc("funnel_stats", { p_since: null }),
    rpc("funnel_stats", { p_since: since30 }),
    rpc("playbook_stats"),
    rpc("objection_stats", { p_since: since30 }),
    listExperiments(["running", "won", "inconclusive"]),
  ]);

  // Ratings + notes the owner wrote in the admin panel (table may not exist on old installs → ignore errors).
  const { data: reviewRows } = await db()
    .from("conversation_reviews")
    .select("lead_id, rating, note, leads(stage, outcome, paid)")
    .is("used_in_batch", null)
    .order("updated_at", { ascending: true })
    .limit(40);
  const reviews = (reviewRows ?? []) as unknown as { lead_id: string; rating: number; note: string | null; leads: Record<string, unknown> | null }[];

  const compact = pending.map((a) => ({
    outcome: a.outcome,
    loss_reason: a.loss_reason,
    drop_stage: a.drop_stage,
    segment: a.segment,
    quality: a.conversation_quality,
    objections: a.objections,
    buying_signals: a.buying_signals,
    missed_signals: a.missed_signals,
    agent_mistakes: a.agent_mistakes,
    what_worked: a.what_worked,
    summary: a.summary,
  }));

  const input = {
    current_playbook: { version: active.version, ...active.content },
    funnel_all_time: funnelAll,
    funnel_last_30_days: funnel30,
    conversion_by_playbook_version: byPlaybook,
    objections_last_30_days: objections,
    experiments: experiments.map((e) => ({ id: e.id, slot: e.slot, name: e.name, status: e.status, metric: e.metric, winner: e.winner, results: e.results })),
    new_conversation_analyses: compact,
    owner_reviews: reviews.map((r) => ({ rating_1_to_5: r.rating, note: r.note, stage: r.leads?.stage, paid: r.leads?.paid })),
  };

  const env = getEnv();
  const { json } = await deepseekJson({
    messages: [
      { role: "system", content: COACH_PROMPT + OWNER_REVIEWS_NOTE },
      { role: "user", content: `DATA (json):\n${JSON.stringify(input)}` },
    ],
    model: INTEGRATION_OVERRIDES.deepseekCoachModel || env.DEEPSEEK_COACH_MODEL || INTEGRATION_OVERRIDES.deepseekModel || env.DEEPSEEK_MODEL,
    thinking: true,
    maxTokens: 6000,
    timeoutMs: 180_000,
    retries: 1,
    label: "coach",
  });

  const parsed = coachSchema.safeParse(json);
  const won = compact.filter((a) => a.outcome === "won").length;

  const batch = must(
    await db()
      .from("learning_batches")
      .insert({
        sample_size: compact.length,
        won_count: won,
        conversion_rate: compact.length ? won / compact.length : 0,
        playbook_version_before: active.version,
        summary: parsed.success ? parsed.data.summary : "Coach output failed validation.",
        biggest_leak: parsed.success ? parsed.data.biggest_leak : null,
        changes: parsed.success ? parsed.data.changes : [],
        raw_output: json ?? null,
      })
      .select("id")
      .single(),
    "coach.batch",
  ) as { id: number };

  // These analyses have now been "spent" whatever the outcome, so the next batch is fresh data.
  await db()
    .from("conversation_analyses")
    .update({ batch_id: batch.id })
    .in("lead_id", pending.map((a) => a.lead_id as string));

  if (reviews.length) {
    await db().from("conversation_reviews").update({ used_in_batch: batch.id }).in("lead_id", reviews.map((r) => r.lead_id));
  }

  if (!parsed.success) {
    const problems = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`);
    await db().from("learning_batches").update({ result: "rejected", problems }).eq("id", batch.id);
    await notifyAdmin(`🧠 Öğrenme turu #${batch.id}: koçun çıktısı bozuktu ve atıldı. Playbook v${active.version} yayında kalıyor.`);
    return { status: "rejected", problems };
  }

  const proposal = { ...parsed.data.playbook, locked_winners: active.content.locked_winners };
  const problems = validateProposal(proposal, active.content);
  if (problems.length) {
    await db().from("learning_batches").update({ result: "rejected", problems }).eq("id", batch.id);
    await notifyAdmin(`🧠 Öğrenme turu #${batch.id}: öneri güvenlik kontrolünden GEÇEMEDİ:\n- ${problems.join("\n- ")}\nPlaybook v${active.version} yayında kalıyor.`);
    return { status: "rejected", problems };
  }

  // Experiments are saved as drafts (or started, in auto mode, when the slot is free).
  const experimentNotes: string[] = [];
  for (const e of parsed.data.experiment_proposals) {
    const result = await createExperiment({
      slot: e.slot,
      name: e.name,
      hypothesis: e.hypothesis,
      metric: e.metric as ExperimentMetric,
      variantA: e.variant_a,
      variantB: e.variant_b,
      createdBy: "coach",
      status: env.PLAYBOOK_AUTO_APPROVE ? "running" : "draft",
    });
    experimentNotes.push("id" in result ? `#${result.id} ${e.name} [${e.slot}] → /activate ${result.id}` : `${e.name}: rejected (${result.rejected})`);
  }

  const unchanged = JSON.stringify(proposal.guidelines) === JSON.stringify(active.content.guidelines) &&
    JSON.stringify(proposal.objection_responses) === JSON.stringify(active.content.objection_responses) &&
    JSON.stringify(proposal.avoid) === JSON.stringify(active.content.avoid);

  if (unchanged) {
    await db().from("learning_batches").update({ result: "unchanged" }).eq("id", batch.id);
    await notifyAdmin(
      `🧠 Learning batch #${batch.id} (${compact.length} conversations, ${won} sales): no playbook change justified.\n${parsed.data.summary}` +
        (experimentNotes.length ? `\n\nExperiment ideas:\n${experimentNotes.join("\n")}` : ""),
    );
    return { status: "unchanged", summary: parsed.data.summary };
  }

  const status = env.PLAYBOOK_AUTO_APPROVE ? "active" : "proposed";
  const saved = await savePlaybook({ content: proposal, status, summary: parsed.data.summary, createdBy: "coach", basedOnBatch: batch.id });
  await db().from("learning_batches").update({ result: status, playbook_version_after: saved.version }).eq("id", batch.id);

  const changeLines = parsed.data.changes
    .filter((c) => c.type !== "none")
    .map((c) => `• ${c.type} ${c.guideline_id}: ${c.reason} (evidence: ${c.evidence_count})`)
    .join("\n");
  await notifyAdmin(
    `🧠 Learning batch #${batch.id} — ${compact.length} conversations, ${won} sales.\nBiggest leak: ${parsed.data.biggest_leak}\n\n${parsed.data.summary}\n\n${changeLines || "(no itemised changes)"}\n\n` +
      (status === "active"
        ? `Playbook v${saved.version} is now LIVE (auto-approve).`
        : `Playbook v${saved.version} is waiting for you:\n/playbook ${saved.version} to read it\n/approve ${saved.version} or /reject ${saved.version}`) +
      (experimentNotes.length ? `\n\nExperiment ideas:\n${experimentNotes.join("\n")}` : ""),
  );
  return { status: status === "active" ? "activated" : "proposed", version: saved.version, summary: parsed.data.summary };
}
