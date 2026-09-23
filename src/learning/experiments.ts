import crypto from "node:crypto";
import { db, must } from "../lib/supabase";
import { EXPERIMENT_SLOTS, LEARNING, type ExperimentMetric, type Stage } from "../config/funnel";
import { twoProportionTest } from "./stats";
import { getActivePlaybook, savePlaybook } from "./playbook";
import { notifyAdmin } from "../lib/admin";
import { findForbiddenClaims } from "../sales/guardrails";

export type Variant = { key: "A" | "B"; instruction: string };

export type Experiment = {
  id: number;
  slot: string;
  name: string;
  hypothesis: string | null;
  metric: ExperimentMetric;
  variants: Variant[];
  status: "draft" | "running" | "won" | "inconclusive" | "stopped";
  min_sample: number;
  max_sample: number;
  winner: string | null;
  p_value: number | null;
  results: Record<string, unknown> | null;
  created_by: string;
  created_at: string;
};

export type Assignment = { experiment_id: number; variant: "A" | "B"; slot: string; instruction: string; exposed: boolean };

export async function listExperiments(statuses?: Experiment["status"][]): Promise<Experiment[]> {
  let query = db().from("experiments").select("*").order("id", { ascending: false }).limit(30);
  if (statuses?.length) query = query.in("status", statuses);
  return must(await query, "experiments.list") as Experiment[];
}

/** Stable 50/50 split: the same lead always lands in the same arm. */
function pickVariant(leadId: string, experimentId: number): "A" | "B" {
  const hash = crypto.createHash("sha256").update(`${experimentId}:${leadId}`).digest();
  return hash[0]! % 2 === 0 ? "A" : "B";
}

/**
 * Called once, when a lead starts the bot. Leads are only enrolled in
 * experiments that are running at that moment → clean cohorts.
 */
export async function assignExperiments(leadId: string): Promise<void> {
  const running = await listExperiments(["running"]);
  if (!running.length) return;
  const rows = running.map((e) => ({ experiment_id: e.id, lead_id: leadId, variant: pickVariant(leadId, e.id) }));
  const { error } = await db().from("experiment_assignments").upsert(rows, { onConflict: "experiment_id,lead_id", ignoreDuplicates: true });
  if (error) console.error("[experiments] assign:", error.message);
}

/** Instructions for THIS lead at THIS stage. Marks exposure, so only people who actually met the variant are counted. */
export async function getLiveInstructions(leadId: string, stage: Stage): Promise<Assignment[]> {
  const { data, error } = await db()
    .from("experiment_assignments")
    .select("experiment_id, variant, exposed, experiments!inner(slot, variants, status)")
    .eq("lead_id", leadId)
    .eq("experiments.status", "running");
  if (error) {
    console.error("[experiments] live:", error.message);
    return [];
  }
  const live: Assignment[] = [];
  for (const row of (data ?? []) as unknown as {
    experiment_id: number;
    variant: "A" | "B";
    exposed: boolean;
    experiments: { slot: string; variants: Variant[] };
  }[]) {
    const stages = EXPERIMENT_SLOTS[row.experiments.slot];
    if (!stages?.includes(stage)) continue;
    const instruction = row.experiments.variants.find((v) => v.key === row.variant)?.instruction;
    if (!instruction) continue;
    live.push({ experiment_id: row.experiment_id, variant: row.variant, slot: row.experiments.slot, instruction, exposed: row.exposed });
  }
  const fresh = live.filter((a) => !a.exposed).map((a) => a.experiment_id);
  if (fresh.length) {
    await db()
      .from("experiment_assignments")
      .update({ exposed: true, exposed_at: new Date().toISOString() })
      .eq("lead_id", leadId)
      .in("experiment_id", fresh);
  }
  return live;
}

function succeeded(metric: ExperimentMetric, lead: Record<string, unknown>): boolean {
  switch (metric) {
    case "reply":
      return Number(lead.user_turns ?? 0) >= 2;
    case "free_join":
      return lead.free_channel_joined === true;
    case "vip_offer":
      return Number(lead.vip_offer_count ?? 0) > 0;
    case "checkout":
      return lead.checkout_started === true;
    case "purchase":
      return lead.paid === true;
  }
}

/** Evaluates every running experiment. A winner needs sample size AND statistical significance. */
export async function evaluateExperiments(): Promise<string[]> {
  const notes: string[] = [];
  const matureBefore = new Date(Date.now() - LEARNING.experimentMaturityDays * 24 * 3600 * 1000).toISOString();

  for (const experiment of await listExperiments(["running"])) {
    const { data, error } = await db()
      .from("experiment_assignments")
      .select("variant, leads!inner(user_turns, free_channel_joined, vip_offer_count, checkout_started, paid, created_at)")
      .eq("experiment_id", experiment.id)
      .eq("exposed", true)
      .lte("leads.created_at", matureBefore)
      .limit(5000);
    if (error) {
      console.error("[experiments] evaluate:", error.message);
      continue;
    }
    const tally = { A: { n: 0, s: 0 }, B: { n: 0, s: 0 } };
    for (const row of (data ?? []) as unknown as { variant: "A" | "B"; leads: Record<string, unknown> }[]) {
      tally[row.variant].n++;
      if (succeeded(experiment.metric, row.leads)) tally[row.variant].s++;
    }
    const test = twoProportionTest(tally.A.s, tally.A.n, tally.B.s, tally.B.n);
    const results = { ...tally, rateA: test.rateA, rateB: test.rateB, pValue: test.pValue, evaluated_at: new Date().toISOString() };

    const enough = tally.A.n >= experiment.min_sample && tally.B.n >= experiment.min_sample;
    const exhausted = tally.A.n >= experiment.max_sample && tally.B.n >= experiment.max_sample;
    let status: Experiment["status"] = "running";
    let winner: string | null = null;

    if (enough && test.pValue < LEARNING.significanceLevel) {
      status = "won";
      winner = test.rateB > test.rateA ? "B" : "A";
    } else if (exhausted) {
      status = "inconclusive";
    }

    await db()
      .from("experiments")
      .update({ results, p_value: test.pValue, status, winner, ended_at: status === "running" ? null : new Date().toISOString() })
      .eq("id", experiment.id);

    if (status === "won" && winner) {
      const instruction = experiment.variants.find((v) => v.key === winner)!.instruction;
      const active = await getActivePlaybook();
      const content = {
        ...active.content,
        locked_winners: [
          ...active.content.locked_winners.filter((w) => w.slot !== experiment.slot),
          { slot: experiment.slot, instruction, experiment_id: experiment.id },
        ],
      };
      const saved = await savePlaybook({
        content,
        status: "active",
        createdBy: "experiment",
        summary: `Experiment #${experiment.id} "${experiment.name}": variant ${winner} won (${pct(test.rateA)} vs ${pct(test.rateB)}, p=${test.pValue.toFixed(3)}).`,
      });
      const note = `🏆 Experiment #${experiment.id} "${experiment.name}" — variant ${winner} WON on ${experiment.metric}: A ${pct(test.rateA)} (n=${tally.A.n}) vs B ${pct(test.rateB)} (n=${tally.B.n}), p=${test.pValue.toFixed(3)}. Locked into playbook v${saved.version}.`;
      notes.push(note);
      await notifyAdmin(note);
    } else if (status === "inconclusive") {
      const note = `⚖️ Experiment #${experiment.id} "${experiment.name}" ended with no significant difference (A ${pct(test.rateA)} vs B ${pct(test.rateB)}). Nothing changed.`;
      notes.push(note);
      await notifyAdmin(note);
    }
  }
  return notes;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export async function createExperiment(input: {
  slot: string;
  name: string;
  hypothesis: string;
  metric: ExperimentMetric;
  variantA: string;
  variantB: string;
  createdBy: "coach" | "admin";
  status: "draft" | "running";
}): Promise<{ id: number } | { rejected: string }> {
  if (!EXPERIMENT_SLOTS[input.slot]) return { rejected: `unknown slot "${input.slot}"` };
  for (const text of [input.variantA, input.variantB]) {
    const claims = findForbiddenClaims(text);
    if (claims.length) return { rejected: `forbidden tactic in variant (${claims.join(", ")})` };
  }
  // One experiment per slot at a time, otherwise instructions collide and results are unreadable.
  if (input.status === "running") {
    const running = await listExperiments(["running"]);
    if (running.some((e) => e.slot === input.slot)) input = { ...input, status: "draft" };
  }
  const row = must(
    await db()
      .from("experiments")
      .insert({
        slot: input.slot,
        name: input.name.slice(0, 80),
        hypothesis: input.hypothesis.slice(0, 500),
        metric: input.metric,
        variants: [
          { key: "A", instruction: input.variantA.slice(0, 400) },
          { key: "B", instruction: input.variantB.slice(0, 400) },
        ],
        status: input.status,
        min_sample: LEARNING.defaultMinSamplePerVariant,
        max_sample: LEARNING.defaultMaxSamplePerVariant,
        created_by: input.createdBy,
        started_at: input.status === "running" ? new Date().toISOString() : null,
      })
      .select("id")
      .single(),
    "experiment.create",
  ) as { id: number };
  return row;
}

export async function setExperimentStatus(id: number, status: "running" | "stopped"): Promise<string> {
  const row = must(await db().from("experiments").select("*").eq("id", id).maybeSingle(), "experiment.get") as Experiment | null;
  if (!row) return `Experiment #${id} not found.`;
  if (status === "running") {
    if (row.status !== "draft") return `Experiment #${id} is "${row.status}", only drafts can be activated.`;
    const running = await listExperiments(["running"]);
    const clash = running.find((e) => e.slot === row.slot);
    if (clash) return `Slot "${row.slot}" already has running experiment #${clash.id}. Stop it first (/stopexp ${clash.id}).`;
    await db().from("experiments").update({ status: "running", started_at: new Date().toISOString() }).eq("id", id);
    return `Experiment #${id} is now running. Only NEW leads are enrolled.`;
  }
  await db().from("experiments").update({ status: "stopped", ended_at: new Date().toISOString() }).eq("id", id);
  return `Experiment #${id} stopped.`;
}
