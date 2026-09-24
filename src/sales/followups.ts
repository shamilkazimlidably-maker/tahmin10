import { INBOX } from "../config/inbox";
import { FOLLOWUPS, FOLLOWUP_RULES, FUNNEL, type FollowupRule } from "../config/funnel";
import { db, must } from "../lib/supabase";
import { getProfile, getRecentMessages, recordEvent, updateLead, type Lead } from "../lib/leads";
import { freeChannelKeyboard, plansKeyboard } from "../lib/telegram";
import { hoursSince, localHour, mapLimit } from "../lib/util";
import { getActivePlaybook } from "../learning/playbook";
import { permissionsFor, runSalesAgent, stageOf } from "./agent";
import { findForbiddenClaims } from "./guardrails";
import { sendToLead } from "./engine";

function bucketOf(lead: Lead): keyof typeof FOLLOWUP_RULES | null {
  if (lead.vip_active || lead.paid) return null;
  if (lead.stage === "NOT_INTERESTED") return null;
  if (lead.checkout_started) return "CHECKOUT";
  if (lead.vip_offer_count > 0) return "VIP_OFFERED";
  if (lead.free_channel_joined) return "ENGAGED";
  if (lead.free_channel_invited) return "FREE_INVITED";
  return "DISCOVERY";
}

function lastActivity(lead: Lead): string {
  const times = [lead.last_user_message_at, lead.last_bot_message_at, lead.checkout_started_at, lead.created_at].filter(Boolean) as string[];
  return times.sort().at(-1)!;
}

export function nextFollowup(lead: Lead): FollowupRule | null {
  if (!lead.chat_id || lead.blocked || lead.opted_out || lead.do_not_sell || lead.needs_human) return null;
  if (lead.followup_count >= FOLLOWUPS.maxPerLeadTotal) return null;
  if (lead.followups_since_reply >= FOLLOWUPS.maxSinceLastReply) return null;
  const bucket = bucketOf(lead);
  if (!bucket) return null;
  const silentHours = hoursSince(lastActivity(lead));
  for (const rule of FOLLOWUP_RULES[bucket] ?? []) {
    if (lead.followups_sent.includes(rule.key)) continue;
    // Rules are ordered; the first unsent one is the next step. Wait for ITS delay.
    return silentHours >= rule.afterSilentHours ? rule : null;
  }
  return null;
}

async function writeFollowup(lead: Lead, rule: FollowupRule): Promise<string> {
  try {
    const stage = stageOf(lead);
    const [profile, history, playbook] = await Promise.all([
      getProfile(lead.id),
      getRecentMessages(lead.id, FUNNEL.historyMessages),
      getActivePlaybook(),
    ]);
    const output = await runSalesAgent({
      lead,
      profile,
      history,
      playbook,
      experiments: [],
      stage,
      permissions: permissionsFor(lead),
      followupMode: true,
      directive: `${rule.goal}\nSilêncio há ~${Math.round(hoursSince(lastActivity(lead)))} horas.${
        rule.keyboard === "plans" ? " Sistem plan düğmelerini ekleyecek." : rule.keyboard === "free_channel" ? " Sistem ücretsiz kanal düğmesini ekleyecek." : ""
      }`,
    });
    const text = output.messages[0];
    if (text && !output.guardrailHits.length && !findForbiddenClaims(text).length) return text;
  } catch (error) {
    console.error("[followup] AI copy failed, using template:", (error as Error).message);
  }
  return rule.fallback;
}

export type FollowupRunResult = { skipped?: string; candidates: number; sent: number; blocked: number; errors: number };

export async function runFollowups(options: { force?: boolean } = {}): Promise<FollowupRunResult> {
  if (INBOX.mode === "human") return { skipped: "human_mode", candidates: 0, sent: 0, blocked: 0, errors: 0 }; // insan modu: takip mesajlarını operatör yazar
  const hour = localHour(FOLLOWUPS.timezone);
  if (!options.force && (hour < FOLLOWUPS.sendFromHour || hour >= FOLLOWUPS.sendUntilHour)) {
    return { skipped: `quiet hours (${hour}h in ${FOLLOWUPS.timezone})`, candidates: 0, sent: 0, blocked: 0, errors: 0 };
  }

  // Cheap SQL pre-filter; the precise rules run in nextFollowup().
  const quietSince = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  const notOlderThan = new Date(Date.now() - 21 * 24 * 3600 * 1000).toISOString();
  const leads = must(
    await db()
      .from("leads")
      .select("*")
      .not("chat_id", "is", null)
      .is("merged_into", null)
      .eq("paid", false)
      .eq("blocked", false)
      .eq("opted_out", false)
      .eq("do_not_sell", false)
      .eq("needs_human", false)
      .neq("stage", "NOT_INTERESTED")
      .lt("followup_count", FOLLOWUPS.maxPerLeadTotal)
      .lt("followups_since_reply", FOLLOWUPS.maxSinceLastReply)
      .lt("updated_at", quietSince)
      .gt("created_at", notOlderThan)
      .order("updated_at", { ascending: true })
      .limit(300),
    "followups.candidates",
  ) as Lead[];

  const due = leads
    .map((lead) => ({ lead, rule: nextFollowup(lead) }))
    .filter((x): x is { lead: Lead; rule: FollowupRule } => x.rule !== null)
    .slice(0, FOLLOWUPS.maxPerRun);

  let sent = 0;
  let blocked = 0;
  let errors = 0;

  await mapLimit(due, 4, async ({ lead, rule }) => {
    try {
      let text = await writeFollowup(lead, rule);
      if (lead.followup_count >= 1) text += FOLLOWUPS.optOutHint;
      const keyboard =
        rule.keyboard === "plans" ? plansKeyboard(lead.start_token) : rule.keyboard === "free_channel" ? freeChannelKeyboard() : undefined;

      // Claim the follow-up BEFORE sending so an overlapping run can never double-send.
      await updateLead(lead.id, {
        followup_count: lead.followup_count + 1,
        followups_since_reply: lead.followups_since_reply + 1,
        followups_sent: [...lead.followups_sent, rule.key],
        last_followup_at: new Date().toISOString(),
      });
      const delivered = await sendToLead(lead, text, { keyboard });
      if (delivered) {
        sent++;
        await recordEvent(lead.id, "FOLLOWUP_SENT", { key: rule.key });
      } else blocked++;
    } catch (error) {
      errors++;
      console.error("[followup]", lead.id, error);
    }
  });

  return { candidates: leads.length, sent, blocked, errors };
}
