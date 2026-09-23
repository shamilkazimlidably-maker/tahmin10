import { db, must } from "./supabase";
import { randomToken, sleep } from "./util";
import { computeScore } from "./score";
import { SIGNALS, type SignalKey, type Stage } from "../config/funnel";

export type Lead = {
  id: string;
  start_token: string;
  visitor_id: string | null;
  telegram_user_id: string | null;
  chat_id: string | null;
  first_name: string | null;
  username: string | null;
  language_code: string | null;

  source: string | null;
  medium: string | null;
  campaign: string | null;
  adset: string | null;
  ad: string | null;
  fbclid: string | null;
  meta_fbc: string | null;
  meta_fbp: string | null;
  client_ip: string | null;
  user_agent: string | null;
  landing_url: string | null;

  stage: Stage;
  score: number;
  playbook_version: number | null;

  user_turns: number;
  pre_free_turns: number;
  post_free_turns: number;
  eligible_turns: number;

  free_channel_invited: boolean;
  free_channel_invited_at: string | null;
  free_channel_joined: boolean;
  free_channel_joined_at: string | null;

  vip_offer_count: number;
  vip_offer_last_at: string | null;
  plans_shown_count: number;

  checkout_started: boolean;
  checkout_started_at: string | null;
  last_checkout_plan: string | null;

  paid: boolean;
  paid_at: string | null;
  first_paid_plan: string | null;
  total_revenue: number;
  currency: string | null;
  vip_active: boolean;
  vip_access_sent: boolean;
  whop_membership_id: string | null;
  whop_user_id: string | null;
  refunded: boolean;

  opted_out: boolean;
  do_not_sell: boolean;
  do_not_sell_reason: string | null;
  blocked: boolean;
  needs_human: boolean;

  followup_count: number;
  followups_since_reply: number;
  followups_sent: string[];
  last_followup_at: string | null;

  last_user_message_at: string | null;
  last_bot_message_at: string | null;

  outcome: "won" | "lost" | null;
  outcome_reason: string | null;
  closed_at: string | null;
  analyzed_at: string | null;

  merged_into: string | null;
  created_at: string;
  updated_at: string;
};

export type Attribution = {
  visitorId?: string | null;
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  adset?: string | null;
  ad?: string | null;
  fbclid?: string | null;
  fbc?: string | null;
  fbp?: string | null;
  clientIp?: string | null;
  userAgent?: string | null;
  landingUrl?: string | null;
};

/* ------------------------------------------------------------------ */
/*  Leads                                                             */
/* ------------------------------------------------------------------ */

export async function createLead(a: Attribution = {}): Promise<Lead> {
  const lead = must(
    await db()
      .from("leads")
      .insert({
        start_token: randomToken(),
        visitor_id: a.visitorId ?? null,
        source: a.source ?? null,
        medium: a.medium ?? null,
        campaign: a.campaign ?? null,
        adset: a.adset ?? null,
        ad: a.ad ?? null,
        fbclid: a.fbclid ?? null,
        meta_fbc: a.fbc ?? null,
        meta_fbp: a.fbp ?? null,
        client_ip: a.clientIp ?? null,
        user_agent: a.userAgent ?? null,
        landing_url: a.landingUrl ?? null,
      })
      .select("*")
      .single(),
    "createLead",
  ) as Lead;
  must(await db().from("lead_profiles").insert({ lead_id: lead.id }), "createLead.profile");
  return lead;
}

async function one(column: string, value: string): Promise<Lead | null> {
  return must(await db().from("leads").select("*").eq(column, value).is("merged_into", null).maybeSingle(), `lead by ${column}`) as Lead | null;
}

export const getLeadById = (id: string) => one("id", id);
export const getLeadByToken = (token: string) => one("start_token", token);
export const getLeadByTelegramId = (id: string | number) => one("telegram_user_id", String(id));
export const getLeadByMembership = (id: string) => one("whop_membership_id", id);

/** Re-use the visitor's recent lead so repeated clicks on the landing page do not create duplicates. */
export async function findRecentLeadByVisitor(visitorId: string): Promise<Lead | null> {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const rows = must(
    await db()
      .from("leads")
      .select("*")
      .eq("visitor_id", visitorId)
      .is("merged_into", null)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1),
    "findRecentLeadByVisitor",
  ) as Lead[];
  return rows[0] ?? null;
}

export async function updateLead(id: string, values: Partial<Lead>): Promise<Lead> {
  return must(
    await db()
      .from("leads")
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single(),
    "updateLead",
  ) as Lead;
}

/**
 * A person who already talked to the bot clicks a NEW ad → new landing lead.
 * Keep the conversation (existing lead), adopt attribution only where empty,
 * and retire the new empty lead.
 */
export async function mergeLeads(keep: Lead, fresh: Lead): Promise<Lead> {
  const patch: Partial<Lead> = {};
  const fields = ["visitor_id", "source", "medium", "campaign", "adset", "ad", "fbclid", "meta_fbc", "meta_fbp", "client_ip", "user_agent", "landing_url"] as const;
  for (const f of fields) {
    if (!keep[f] && fresh[f]) (patch as Record<string, unknown>)[f] = fresh[f];
  }
  await updateLead(fresh.id, { merged_into: keep.id });
  return Object.keys(patch).length ? updateLead(keep.id, patch) : keep;
}

/* ------------------------------------------------------------------ */
/*  Per-lead lock — two quick messages must not be answered in parallel */
/* ------------------------------------------------------------------ */

export async function withLeadLock<T>(leadId: string, fn: () => Promise<T>): Promise<T> {
  let locked = false;
  for (let i = 0; i < 25 && !locked; i++) {
    const { data, error } = await db().rpc("acquire_lead_lock", { p_lead_id: leadId, p_seconds: 75 });
    if (error) {
      console.error("[lock]", error.message);
      break; // never block the customer because of the lock itself
    }
    locked = data === true;
    if (!locked) await sleep(1000);
  }
  try {
    return await fn();
  } finally {
    if (locked) await db().from("leads").update({ lock_until: null }).eq("id", leadId);
  }
}

/* ------------------------------------------------------------------ */
/*  Messages & events                                                 */
/* ------------------------------------------------------------------ */

export type StoredMessage = { role: "user" | "assistant" | "event"; content: string; created_at: string };

/** Returns false if this Telegram message was already stored (webhook retry). */
export async function recordMessage(
  leadId: string,
  role: StoredMessage["role"],
  content: string,
  telegramMessageId?: number | null,
): Promise<boolean> {
  const { error } = await db()
    .from("messages")
    .insert({ lead_id: leadId, role, content, telegram_message_id: telegramMessageId ?? null });
  if (error) {
    if (error.code === "23505") return false;
    throw new Error(`[db] recordMessage: ${error.message}`);
  }
  return true;
}

export async function getRecentMessages(leadId: string, limit: number): Promise<StoredMessage[]> {
  const rows = must(
    await db()
      .from("messages")
      .select("role, content, created_at")
      .eq("lead_id", leadId)
      .order("id", { ascending: false })
      .limit(limit),
    "getRecentMessages",
  ) as StoredMessage[];
  return rows.reverse();
}

export async function getAllMessages(leadId: string, max = 200): Promise<StoredMessage[]> {
  return must(
    await db().from("messages").select("role, content, created_at").eq("lead_id", leadId).order("id", { ascending: true }).limit(max),
    "getAllMessages",
  ) as StoredMessage[];
}

/** Never throws: analytics must not break a conversation. */
export async function recordEvent(leadId: string | null, name: string, data: Record<string, unknown> = {}): Promise<void> {
  const { error } = await db().from("sales_events").insert({ lead_id: leadId, name, data });
  if (error) console.error("[event]", name, error.message);
}

/* ------------------------------------------------------------------ */
/*  Signals & score                                                   */
/* ------------------------------------------------------------------ */

export type SignalInput = { value: number; evidence?: string };
const SIGNAL_KEYS = new Set<string>(SIGNALS.map((s) => s.key));
const SOURCE_BY_KEY = new Map<string, string>(SIGNALS.map((s) => [s.key, s.source]));

/**
 * Signals are STICKY: the model only sees recent history, so a later
 * "0" must never erase evidence that was real. Values only go up.
 */
export async function applySignals(leadId: string, signals: Record<string, SignalInput>, from: "ai" | "system"): Promise<number> {
  const incoming = Object.entries(signals).filter(([key, s]) => {
    if (!SIGNAL_KEYS.has(key)) return false;
    // The AI may never set behaviour the backend is supposed to verify.
    if (from === "ai" && SOURCE_BY_KEY.get(key) !== "ai") return false;
    return Number(s?.value) > 0;
  });

  const existing = must(await db().from("lead_signals").select("key, value").eq("lead_id", leadId), "signals.read") as {
    key: string;
    value: number;
  }[];
  const current = new Map(existing.map((r) => [r.key, Number(r.value)]));

  const rows = incoming
    .map(([key, s]) => ({ key, value: Math.min(1, Math.max(0, Number(s.value))), evidence: String(s.evidence ?? "").slice(0, 300) }))
    .filter((r) => r.value > (current.get(r.key) ?? 0))
    .map((r) => ({ lead_id: leadId, ...r, source: from, updated_at: new Date().toISOString() }));

  if (rows.length) {
    must(await db().from("lead_signals").upsert(rows, { onConflict: "lead_id,key" }), "signals.upsert");
    for (const r of rows) current.set(r.key, r.value);
  }

  const score = computeScore([...current.entries()].map(([key, value]) => ({ key, value })));
  await db().from("leads").update({ score, updated_at: new Date().toISOString() }).eq("id", leadId);
  return score;
}

export const setSystemSignal = (leadId: string, key: SignalKey, evidence: string) =>
  applySignals(leadId, { [key]: { value: 1, evidence } }, "system");

/* ------------------------------------------------------------------ */
/*  Profile memory                                                    */
/* ------------------------------------------------------------------ */

export type Profile = {
  favorite_team: string | null;
  leagues: string[];
  prediction_usage: string | null;
  wants: string[];
  pain_points: string[];
  objections: string[];
  style: string | null;
  notes: string | null;
  segment: string | null;
};

export async function getProfile(leadId: string): Promise<Profile | null> {
  return must(await db().from("lead_profiles").select("*").eq("lead_id", leadId).maybeSingle(), "getProfile") as Profile | null;
}

function mergeList(old: unknown, add: unknown, max = 12): string[] {
  const a = Array.isArray(old) ? (old as unknown[]) : [];
  const b = Array.isArray(add) ? (add as unknown[]) : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of [...a, ...b]) {
    if (typeof item !== "string") continue;
    const clean = item.trim().slice(0, 120);
    const k = clean.toLowerCase();
    if (!clean || seen.has(k)) continue;
    seen.add(k);
    out.push(clean);
  }
  return out.slice(-max);
}

export async function mergeProfile(leadId: string, update: Partial<Profile> & { objection?: string | null }): Promise<void> {
  const current = await getProfile(leadId);
  const text = (next: unknown, prev: string | null | undefined, max: number) =>
    typeof next === "string" && next.trim() ? next.trim().slice(0, max) : (prev ?? null);

  const values = {
    lead_id: leadId,
    favorite_team: text(update.favorite_team, current?.favorite_team, 80),
    leagues: mergeList(current?.leagues, update.leagues),
    prediction_usage: text(update.prediction_usage, current?.prediction_usage, 200),
    wants: mergeList(current?.wants, update.wants),
    pain_points: mergeList(current?.pain_points, update.pain_points),
    objections: mergeList(current?.objections, update.objection ? [update.objection] : []),
    style: text(update.style, current?.style, 120),
    notes: text(update.notes, current?.notes, 400),
    segment: text(update.segment, current?.segment, 40),
    updated_at: new Date().toISOString(),
  };
  const { error } = await db().from("lead_profiles").upsert(values, { onConflict: "lead_id" });
  if (error) console.error("[profile]", error.message);
}
