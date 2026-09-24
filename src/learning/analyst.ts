import { z } from "zod";
import { deepseekJson } from "../lib/deepseek";
import { db, must } from "../lib/supabase";
import { getAllMessages, mergeProfile, type Lead } from "../lib/leads";
import { LOSS_REASONS, PROMPT_TEXTS, SEGMENTS } from "../config/prompts";

const score = z.coerce.number().min(0).max(10).catch(5);
const list = z
  .array(z.string())
  .catch([])
  .transform((items) => items.map((s) => s.slice(0, 200)).slice(0, 8));

const analysisSchema = z.object({
  outcome: z.enum(["won", "lost"]).catch("lost"),
  loss_reason: z.enum(LOSS_REASONS).nullable().catch("OTHER"),
  drop_stage: z.string().max(30).catch("NONE"),
  segment: z.enum(SEGMENTS).catch("unknown"),
  objections: list,
  buying_signals: list,
  missed_signals: list,
  agent_mistakes: list,
  what_worked: list,
  quality: z
    .object({
      answered_questions: score,
      brevity: score,
      relevance: score,
      no_repetition: score,
      offer_timing: score,
      honesty: score,
    })
    .catch({ answered_questions: 5, brevity: 5, relevance: 5, no_repetition: 5, offer_timing: 5, honesty: 5 }),
  summary: z.string().max(600).catch(""),
});

export type Analysis = z.infer<typeof analysisSchema>;

export async function analyzeLead(lead: Lead): Promise<Analysis | null> {
  const messages = await getAllMessages(lead.id, 160);
  const userMessages = messages.filter((m) => m.role === "user").length;

  // Nothing to learn from someone who never wrote a word — record it cheaply, without an AI call.
  if (userMessages === 0) {
    await store(lead, {
      outcome: "lost",
      loss_reason: "NO_RESPONSE",
      drop_stage: "DISCOVERY",
      segment: "unknown",
      objections: [],
      buying_signals: [],
      missed_signals: [],
      agent_mistakes: [],
      what_worked: [],
      quality: { answered_questions: 5, brevity: 5, relevance: 5, no_repetition: 5, offer_timing: 5, honesty: 10 },
      summary: "Started the bot but never replied.",
    }, 0);
    return null;
  }

  const transcript = messages
    .map((m) => (m.role === "event" ? `[SYSTEM] ${m.content}` : `${m.role === "user" ? "CUSTOMER" : "BOT"}: ${m.content}`))
    .join("\n");

  const facts = {
    outcome_known_by_system: lead.paid ? "won" : "lost",
    system_close_reason: lead.outcome_reason,
    joined_free_channel: lead.free_channel_joined,
    vip_offers_made: lead.vip_offer_count,
    plans_shown: lead.plans_shown_count,
    checkout_started: lead.checkout_started,
    paid: lead.paid,
    plan: lead.first_paid_plan,
    score_at_end: lead.score,
    customer_messages: userMessages,
    followups_sent: lead.followups_sent,
    do_not_sell_reason: lead.do_not_sell_reason,
    campaign: lead.campaign,
    playbook_version: lead.playbook_version,
  };

  const { json } = await deepseekJson({
    messages: [
      { role: "system", content: PROMPT_TEXTS.analyst },
      { role: "user", content: `SYSTEM FACTS:\n${JSON.stringify(facts, null, 2)}\n\nTRANSCRIPT:\n${transcript.slice(-24_000)}` },
    ],
    temperature: 0.2,
    maxTokens: 1400,
    thinking: false,
    timeoutMs: 60_000,
    retries: 1,
    label: "analyst",
  });

  const analysis = analysisSchema.parse(json ?? {});
  // The database knows the truth about payment; the model does not get a vote.
  analysis.outcome = lead.paid ? "won" : "lost";
  if (lead.paid) analysis.loss_reason = null;
  else if (!analysis.loss_reason) analysis.loss_reason = "OTHER";

  await store(lead, analysis, userMessages);
  await mergeProfile(lead.id, { segment: analysis.segment });
  return analysis;
}

async function store(lead: Lead, a: Analysis, userMessages: number): Promise<void> {
  const q = a.quality;
  const quality = Math.round(((q.answered_questions + q.brevity + q.relevance + q.no_repetition + q.offer_timing + q.honesty) / 60) * 100);
  must(
    await db()
      .from("conversation_analyses")
      .upsert(
        {
          lead_id: lead.id,
          outcome: a.outcome,
          loss_reason: a.loss_reason,
          drop_stage: a.drop_stage,
          segment: a.segment,
          objections: a.objections,
          buying_signals: a.buying_signals,
          missed_signals: a.missed_signals,
          agent_mistakes: a.agent_mistakes,
          what_worked: a.what_worked,
          quality_detail: a.quality,
          conversation_quality: quality,
          summary: a.summary,
          user_messages: userMessages,
          playbook_version: lead.playbook_version,
          batch_id: null,
          created_at: new Date().toISOString(),
        },
        { onConflict: "lead_id" },
      ),
    "analysis.store",
  );
  must(await db().from("leads").update({ analyzed_at: new Date().toISOString() }).eq("id", lead.id), "analysis.mark");
}
