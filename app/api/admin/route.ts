/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { LEARNING, type ExperimentMetric } from "@/src/config/funnel";
import { analyticsAiHistory, getAnalytics, runAnalyticsAi, saveSpend, spDate } from "@/src/lib/analytics";
import { purgeVisits, visitorStats } from "@/src/lib/visits";
import { explainClaims, findForbiddenClaims, isOptOut } from "@/src/sales/guardrails";
import { isDirectBuying } from "@/src/config/commands";
import { deleteFromChannel, deletePostRow, deleteTemplate, duplicatePost, editInChannel, pinInChannel, PostError, postsOverview, runDuePosts, savePost, saveTemplate, sendPost, stopPoll, uploadMedia, validatePost } from "@/src/sales/posts";
import { envProblems, getEnv, type Env } from "@/src/lib/env";
import { deepseekJson } from "@/src/lib/deepseek";
import { getLeadById, getLeadByTelegramId, recordEvent, recordMessage, updateLead, type Lead, type StoredMessage } from "@/src/lib/leads";
import { allowRequest } from "@/src/lib/rate-limit";
import { metaConfig } from "@/src/lib/integrations";
import { lastMetaError, sendMetaEvent, testMetaConnection } from "@/src/lib/meta";
import { META_EVENTS } from "@/src/config/funnel";
import { loadSettings, resetSection, saveKnowledge, saveSection, SettingsError, settingsView, type SettingsSection } from "@/src/lib/settings";
import { db } from "@/src/lib/supabase";
import { registerWebhook, sendText, tg, registerCommands } from "@/src/lib/telegram";
import { clientIp, safeEqual } from "@/src/lib/util";
import { createExperiment, listExperiments, setExperimentStatus } from "@/src/learning/experiments";
import { purgeOldData, runLearningCycle } from "@/src/learning/pipeline";
import { activatePlaybook, DEFAULT_PLAYBOOK, getActivePlaybook, playbookContentSchema, rejectPlaybook, savePlaybook, validateProposal } from "@/src/learning/playbook";
import { permissionsFor, runSalesAgent, stageOf } from "@/src/sales/agent";
import { runFollowups } from "@/src/sales/followups";
import { linkPaymentToLead } from "@/src/sales/payments";
import { closeTicketFromPanel, deleteTicket } from "@/src/sales/support";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/* ------------------------------------------------------------------ */
/*  Login: ADMIN_PASSWORD (or SETUP_SECRET if not set) → signed cookie  */
/* ------------------------------------------------------------------ */

const COOKIE = "t10_admin";
const WEEK = 7 * 24 * 3600;
const password = (env: Env) => process.env.ADMIN_PASSWORD?.trim() || env.SETUP_SECRET;
const sign = (exp: number, env: Env) => crypto.createHmac("sha256", `${env.SETUP_SECRET}|${password(env)}|admin`).update(String(exp)).digest("base64url");

function isAuthed(request: NextRequest, env: Env): boolean {
  const [exp, sig] = (request.cookies.get(COOKIE)?.value ?? "").split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, sign(Number(exp), env));
}

class UserError extends Error {}
const bad = (message: string): never => {
  throw new UserError(message);
};
const sinceDays = (days: number) => new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
const int = (v: unknown, min: number, max: number, fallback: number) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Math.round(Number(v)))) : fallback);

async function rpc(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await db().rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message} — supabase/schema.sql çalıştırıldı mı?`);
  return data;
}
async function countOf(table: string, build: (q: any) => any): Promise<number> {
  const { count } = await build(db().from(table).select("*", { count: "exact", head: true }));
  return count ?? 0;
}
async function rows(query: any): Promise<any[]> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}
/** Same, but a missing table (admin_panel.sql not run yet) just means "nothing". */
async function softRows(query: any): Promise<any[]> {
  const { data } = await query;
  return data ?? [];
}

/* ------------------------------------------------------------------ */
/*  Test chat: run the real sales agent against an imaginary person     */
/* ------------------------------------------------------------------ */

function fakeLead(scenario: string, userTurns: number): Lead {
  const now = new Date().toISOString();
  const joined = ["engaged", "offered", "checkout", "paid"].includes(scenario);
  const offered = ["offered", "checkout"].includes(scenario);
  const lead = {
    id: "00000000-0000-0000-0000-000000000000", start_token: "test", telegram_user_id: "0", chat_id: "0", first_name: "Test",
    stage: "NEW", score: joined ? 70 : 15, playbook_version: null,
    user_turns: userTurns, pre_free_turns: joined ? 3 : userTurns, post_free_turns: joined ? Math.max(2, userTurns) : 0, eligible_turns: joined ? 2 : 0,
    free_channel_invited: scenario !== "new", free_channel_joined: joined,
    vip_offer_count: offered ? 1 : 0, vip_offer_last_at: offered ? now : null, plans_shown_count: offered ? 1 : 0,
    checkout_started: scenario === "checkout", last_checkout_plan: scenario === "checkout" ? "monthly" : null,
    paid: scenario === "paid", vip_active: scenario === "paid",
    do_not_sell: false, opted_out: false, blocked: false, needs_human: false, followups_sent: [], created_at: now, updated_at: now,
  };
  return lead as unknown as Lead;
}

/* ------------------------------------------------------------------ */
/*  Actions                                                            */
/* ------------------------------------------------------------------ */

async function handle(action: string, body: any): Promise<unknown> {
  switch (action) {
    case "ping":
      return { ok: true };
    /* ---------------- overview ---------------- */
    case "overview": {
      const days = int(body.days, 0, 365, 7);
      const since = days ? sinceDays(days) : null;
      const [period, campaigns, objections, needsHuman, unlinked, proposals, tickets, sales] = await Promise.all([
        rpc("funnel_stats", { p_since: since }),
        rpc("campaign_stats", { p_since: since }),
        rpc("objection_stats", { p_since: since }),
        countOf("leads", (q) => q.eq("needs_human", true).is("merged_into", null)),
        countOf("payments", (q) => q.is("lead_id", null).eq("status", "paid")),
        countOf("playbooks", (q) => q.eq("status", "proposed")),
        countOf("support_tickets", (q) => q.eq("status", "open")),
        rows(db().from("payments").select("whop_payment_id, amount, currency, plan_key, is_first, status, created_at, leads(first_name, username)").order("created_at", { ascending: false }).limit(8)),
      ]);
      return { period, campaigns, objections, alerts: { needsHuman, unlinked, proposals, tickets }, sales };
    }

    /* ---------------- conversations ---------------- */
    case "leads": {
      const page = int(body.page, 0, 500, 0);
      let q = db()
        .from("leads")
        .select("id, first_name, username, telegram_user_id, stage, score, paid, vip_active, needs_human, do_not_sell, opted_out, blocked, outcome, campaign, user_turns, checkout_started, last_user_message_at, created_at")
        .not("telegram_user_id", "is", null)
        .is("merged_into", null);
      const f = String(body.filter ?? "all");
      if (f === "needs_human") q = q.eq("needs_human", true);
      if (f === "hot") q = q.eq("paid", false).gte("score", 60);
      if (f === "checkout") q = q.eq("paid", false).eq("checkout_started", true);
      if (f === "paid") q = q.eq("paid", true);
      if (f === "lost") q = q.eq("outcome", "lost");
      const term = String(body.q ?? "").replace(/[^\p{L}\p{N}_ .@-]/gu, "").replace(/^@/, "").trim().slice(0, 40);
      if (term) q = q.or(`first_name.ilike.%${term}%,username.ilike.%${term}%,telegram_user_id.eq.${/^\d+$/.test(term) ? term : "0"}`);
      const list = await rows(q.order("last_user_message_at", { ascending: false, nullsFirst: false }).range(page * 40, page * 40 + 39));
      const reviews = list.length ? await softRows(db().from("conversation_reviews").select("lead_id, rating").in("lead_id", list.map((l) => l.id))) : [];
      const ratingOf = new Map(reviews.map((r) => [r.lead_id, r.rating]));
      return { leads: list.map((l) => ({ ...l, rating: ratingOf.get(l.id) ?? null })), page, hasMore: list.length === 40 };
    }

    case "lead": {
      const id = String(body.id ?? "");
      const lead = (await getLeadById(id)) ?? bad("Kişi bulunamadı.");
      const [profile, signals, messages, analysis, review, payments, events] = await Promise.all([
        rows(db().from("lead_profiles").select("*").eq("lead_id", id)),
        rows(db().from("lead_signals").select("key, value, evidence, source").eq("lead_id", id)),
        rows(db().from("messages").select("id, role, content, created_at").eq("lead_id", id).order("id", { ascending: false }).limit(300)),
        rows(db().from("conversation_analyses").select("*").eq("lead_id", id)),
        softRows(db().from("conversation_reviews").select("rating, note, used_in_batch, updated_at").eq("lead_id", id)),
        rows(db().from("payments").select("whop_payment_id, amount, currency, plan_key, status, billing_reason, created_at").eq("lead_id", id).order("created_at", { ascending: false })),
        rows(db().from("sales_events").select("name, data, created_at").eq("lead_id", id).order("id", { ascending: false }).limit(40)),
      ]);
      return { lead, profile: profile[0] ?? null, signals, messages: messages.reverse(), analysis: analysis[0] ?? null, review: review[0] ?? null, payments, events };
    }

    case "lead_action": {
      const lead = (await getLeadById(String(body.id ?? ""))) ?? bad("Kişi bulunamadı.");
      const op = String(body.op);
      if (op === "say") {
        const text = String(body.text ?? "").trim().slice(0, 3500) || bad("Mesaj boş.");
        if (!lead.chat_id) bad("Bu kişinin Telegram sohbeti yok.");
        await sendText(lead.chat_id!, text);
        await recordMessage(lead.id, "assistant", text);
        await updateLead(lead.id, { last_bot_message_at: new Date().toISOString() });
        await recordEvent(lead.id, "ADMIN_MESSAGE", { via: "panel" });
      } else if (op === "human_done") await updateLead(lead.id, { needs_human: false });
      else if (op === "human_needed") await updateLead(lead.id, { needs_human: true });
      else if (op === "sell_off") {
        await updateLead(lead.id, { do_not_sell: true, do_not_sell_reason: "owner" });
        await sendMetaEvent({ ...META_EVENTS.doNotTarget, eventId: `dnt_${lead.id}`, lead });
      }
      else if (op === "sell_on") await updateLead(lead.id, { do_not_sell: false, do_not_sell_reason: null });
      else bad("Bilinmeyen işlem.");
      return { ok: true };
    }

    case "review_save": {
      const rating = int(body.rating, 1, 5, 0) || bad("1 ile 5 arasında puan verin.");
      const { error } = await db()
        .from("conversation_reviews")
        .upsert({ lead_id: String(body.lead_id), rating, note: String(body.note ?? "").trim().slice(0, 1500) || null, used_in_batch: null, updated_at: new Date().toISOString() }, { onConflict: "lead_id" });
      if (error) bad(`Kaydedilemedi: ${error.message}. Supabase'de supabase/admin_panel.sql dosyasını çalıştırdınız mı?`);
      return { ok: true };
    }

    case "translate": {
      const texts: string[] = (Array.isArray(body.texts) ? body.texts : []).slice(0, 80).map((t: unknown) => String(t).slice(0, 700));
      if (!texts.length) return { t: [] };
      const { json } = await deepseekJson({
        messages: [
          { role: "system", content: 'You translate chat messages into Turkish. Reply ONLY with a json object {"t": ["...", "..."]} that has EXACTLY the same number of items, in the same order. Keep emojis and names. No comments.' },
          { role: "user", content: JSON.stringify({ items: texts }) },
        ],
        temperature: 0.1, maxTokens: 6000, thinking: false, timeoutMs: 90_000, retries: 1, label: "admin-translate",
      });
      const t = (json as { t?: unknown })?.t;
      return { t: Array.isArray(t) && t.length === texts.length ? t.map(String) : bad("Çeviri başarısız oldu, tekrar deneyin.") };
    }

    /* ---------------- settings ---------------- */
    case "settings_get":
      await loadSettings(true);
      return settingsView();
    case "settings_save":
    case "settings_reset": {
      const section = String(body.section) as SettingsSection;
      if (!["business", "prompts", "rules", "texts", "landing", "safe", "gate", "integrations", "prompts_full", "guard", "theme", "commands"].includes(section)) bad("Bilinmeyen bölüm.");
      if (action === "settings_save") await saveSection(section, body.value);
      else await resetSection(section);
      await recordEvent(null, action === "settings_save" ? "ADMIN_SETTINGS_SAVED" : "ADMIN_SETTINGS_RESET", { section });
      return settingsView();
    }

    case "kb_save":
      await saveKnowledge(body.entries);
      await recordEvent(null, "ADMIN_KNOWLEDGE_SAVED", {});
      return { knowledge: settingsView().knowledge };

    case "test_chat": {
      const history: { role: string; content: string }[] = (Array.isArray(body.history) ? body.history : []).slice(-24);
      if (!history.length || history[history.length - 1]!.role !== "user") bad("Önce müşteri olarak bir mesaj yazın.");
      const stored: StoredMessage[] = history.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content).slice(0, 2000), created_at: new Date().toISOString() }));
      const lead = fakeLead(String(body.scenario ?? "new"), stored.filter((m) => m.role === "user").length);
      const stage = stageOf(lead);
      const permissions = permissionsFor(lead);
      const out = await runSalesAgent({ lead, profile: null, history: stored, playbook: await getActivePlaybook(), experiments: [], stage, permissions });
      return { ...out, stage, permissions };
    }

    /* ---------------- learning ---------------- */
    case "learning": {
      const [active, proposals, versions, batches, experiments, pending, analyses, freshReviews] = await Promise.all([
        getActivePlaybook(),
        rows(db().from("playbooks").select("version, summary, content, created_by, created_at").eq("status", "proposed").order("version", { ascending: false })),
        rows(db().from("playbooks").select("version, status, summary, created_by, created_at").order("version", { ascending: false }).limit(15)),
        rows(db().from("learning_batches").select("id, sample_size, won_count, summary, biggest_leak, changes, result, problems, playbook_version_after, created_at").order("id", { ascending: false }).limit(10)),
        listExperiments(),
        countOf("conversation_analyses", (q) => q.is("batch_id", null).gt("user_messages", 0)),
        rows(db().from("conversation_analyses").select("lead_id, outcome, loss_reason, drop_stage, conversation_quality, summary, agent_mistakes, what_worked, created_at, leads(first_name, username)").gt("user_messages", 0).order("created_at", { ascending: false }).limit(25)),
        softRows(db().from("conversation_reviews").select("lead_id").is("used_in_batch", null)),
      ]);
      return { active, defaultPlaybook: DEFAULT_PLAYBOOK, proposals, versions, batches, experiments, pending, needed: LEARNING.coachBatchSize, analyses, freshReviews: freshReviews.length };
    }

    case "playbook_decide": {
      const version = int(body.version, 2, 100000, 0);
      const ok = body.approve ? await activatePlaybook(version) : await rejectPlaybook(version);
      if (!ok) bad(`v${version} bekleyen bir öneri değil.`);
      await recordEvent(null, body.approve ? "ADMIN_PLAYBOOK_APPROVED" : "ADMIN_PLAYBOOK_REJECTED", { version });
      return { ok: true };
    }

    case "playbook_save": {
      const active = await getActivePlaybook();
      const parsed = playbookContentSchema.safeParse({ ...body.content, locked_winners: active.content.locked_winners });
      if (!parsed.success) bad("Playbook biçimi hatalı: " + parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join(" | "));
      // The owner may change as much as they like; the honesty / no-pressure checks still apply.
      const problems = validateProposal(parsed.data!, active.content).filter((p) => !p.startsWith("too many guideline changes"));
      if (problems.length) bad("Güvenlik kontrolü reddetti:\n" + problems.join("\n"));
      const saved = await savePlaybook({ content: parsed.data!, status: "active", summary: String(body.summary ?? "").slice(0, 500) || "Edited by the owner in the admin panel.", createdBy: "admin" });
      return { version: saved.version };
    }

    case "experiment_create": {
      const r = await createExperiment({
        slot: String(body.slot), name: String(body.name ?? "").trim() || bad("Test adı gerekli."), hypothesis: String(body.hypothesis ?? ""),
        metric: String(body.metric ?? "purchase") as ExperimentMetric,
        variantA: String(body.variantA ?? "").trim(), variantB: String(body.variantB ?? "").trim(), createdBy: "admin", status: body.start ? "running" : "draft",
      });
      return "id" in r ? r : bad(`Test reddedildi: ${r.rejected}`);
    }
    case "experiment_status":
      return { message: await setExperimentStatus(int(body.id, 1, 1e9, 0), body.status === "running" ? "running" : "stopped") };

    case "run_learning":
      await loadSettings(true);
      return runLearningCycle({ forceCoach: Boolean(body.force), digest: false });
    case "run_followups":
      await loadSettings(true);
      return runFollowups({ force: true });

    /* ---------------- payments ---------------- */
    case "payments":
      return { payments: await rows(db().from("payments").select("whop_payment_id, amount, currency, plan_key, status, is_first, matched_by, billing_reason, email, created_at, lead_id, leads(first_name, username, telegram_user_id)").order("created_at", { ascending: false }).limit(80)) };
    case "payment_link": {
      const lead = (await getLeadByTelegramId(String(body.telegram_id ?? "").trim())) ?? bad("Bu Telegram ID ile botu başlatmış kimse yok.");
      return { message: await linkPaymentToLead(String(body.payment_id), lead) };
    }

    case "commands_sync":
      await registerCommands();
      return { ok: true };
    case "guard_test": {
      const t = String(body.text ?? "").slice(0, 2000);
      return { claims: findForbiddenClaims(t), explain: explainClaims(t), optOut: isOptOut(t), directBuying: isDirectBuying(t) };
    }

    /* ---------------- channel posts ---------------- */
    case "posts_overview":
      return postsOverview();
    case "post_validate":
      return { ok: true, post: validatePost(body.post as Record<string, unknown>, { allowClaims: Boolean(body.allowClaims) }) };
    case "post_save": {
      const mode = body.mode === "schedule" ? "schedule" : body.mode === "send" ? "send" : "draft";
      const row = await savePost(validatePost(body.post as Record<string, unknown>, { allowClaims: Boolean(body.allowClaims) }), mode);
      await recordEvent(null, "ADMIN_POST_SAVED", { post: row.id, mode });
      return { post: row };
    }
    case "post_send_now": {
      const row = await sendPost(Number(body.id));
      return { post: row };
    }
    case "post_edit_live": {
      await editInChannel(Number(body.id), validatePost(body.post as Record<string, unknown>, { allowClaims: Boolean(body.allowClaims) }));
      return { ok: true };
    }
    case "post_duplicate":
      return { post: await duplicatePost(Number(body.id)) };
    case "post_delete_row":
      await deletePostRow(Number(body.id));
      return { ok: true };
    case "post_delete_channel":
      await deleteFromChannel(Number(body.id));
      return { ok: true };
    case "post_stop_poll":
      await stopPoll(Number(body.id));
      return { ok: true };
    case "post_pin":
      await pinInChannel(Number(body.id), body.pin !== false);
      return { ok: true };
    case "post_run_due":
      return runDuePosts();
    case "post_media_upload":
      return uploadMedia(String(body.data ?? ""), String(body.mime ?? ""));
    case "template_save":
      await saveTemplate({ ...validatePost(body.post as Record<string, unknown>, { allowClaims: Boolean(body.allowClaims) }), templateId: body.templateId ? Number(body.templateId) : null });
      return { ok: true };
    case "template_delete":
      await deleteTemplate(Number(body.id));
      return { ok: true };

    /* ---------------- visitor filter ---------------- */
    case "visits": {
      const days = Math.min(90, Math.max(1, Number(body.days) || 7));
      return { days, ...(await visitorStats(days)) };
    }
    case "visits_clear": {
      const deleted = await purgeVisits(Number(body.days) || 0);
      await recordEvent(null, "ADMIN_VISITS_CLEARED", { deleted });
      return { deleted };
    }

    /* ---------------- analytics ---------------- */
    case "analytics":
    case "analytics_ai": {
      const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
      const to = isDay(body.to) ? body.to : spDate(new Date());
      const from = isDay(body.from) && body.from <= to ? body.from : spDate(new Date(Date.now() - 29 * 86_400_000));
      const data = await getAnalytics(from, to);
      if (action === "analytics_ai") return { entry: await runAnalyticsAi(data) };
      return { ...data, aiHistory: await analyticsAiHistory() };
    }
    case "spend_save": {
      const days = await saveSpend({ from: String(body.from), to: String(body.to), campaign: String(body.campaign ?? ""), amount: Number(body.amount), note: String(body.note ?? "") });
      return { days };
    }
    case "spend_delete": {
      const { error } = await db().from("ad_spend").delete().eq("batch", String(body.batch));
      if (error) throw new Error(error.message);
      return { ok: true };
    }

    /* ---------------- Meta audiences: customer-list files (only buyers have an e-mail) ---------------- */
    case "audience_export": {
      const segment = String(body.segment);
      const list = await rows(db().from("payments").select("email, amount, status, lead_id, leads(vip_active, opted_out, do_not_sell, refunded)").not("email", "is", null).limit(20000));
      const people = new Map<string, { value: number; active: boolean; blocked: boolean; known: boolean }>();
      for (const p of list) {
        const email = String(p.email).trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) continue;
        const person = people.get(email) ?? { value: 0, active: false, blocked: false, known: false };
        if (p.status !== "refunded") person.value += Number(p.amount ?? 0);
        if (p.leads) { person.known = true; person.active ||= Boolean(p.leads.vip_active); person.blocked ||= Boolean(p.leads.opted_out || p.leads.do_not_sell); }
        people.set(email, person);
      }
      const chosen = [...people.entries()].filter(([, v]) =>
        segment === "active" ? v.active : segment === "churned" ? v.known && !v.active && !v.blocked && v.value > 0 : segment === "customers" ? v.value > 0 : bad("Bilinmeyen liste."));
      const csv = ["email,country,value", ...chosen.map(([email, v]) => `${email},BR,${v.value.toFixed(2)}`)].join("\n");
      await recordEvent(null, "ADMIN_AUDIENCE_EXPORT", { segment, count: chosen.length });
      return { csv, count: chosen.length, filename: `tahmin10_${segment}_${spDate(new Date())}.csv` };
    }

    case "meta_test":
      await loadSettings(true);
      return testMetaConnection();

    case "playbook_restore": {
      const version = int(body.version, 1, 100000, 0);
      const content = version === 1 ? DEFAULT_PLAYBOOK : (await rows(db().from("playbooks").select("content").eq("version", version)))[0]?.content;
      const parsed = playbookContentSchema.safeParse(content);
      if (!parsed.success) bad(`v${version} bulunamadı.`);
      const saved = await savePlaybook({ content: parsed.data!, status: "active", summary: `Restored from v${version} by the owner.`, createdBy: "admin" });
      return { version: saved.version };
    }

    /* ---------------- support tickets ---------------- */
    case "tickets":
      return { tickets: await softRows(db().from("support_tickets").select("id, status, reason, last_activity_at, created_at, solved_at, lead_id, leads(first_name, username, telegram_user_id, vip_active)").order("id", { ascending: false }).limit(80)) };
    case "ticket_action": {
      const id = int(body.id, 1, 1e12, 0);
      if (body.op === "solve") (await closeTicketFromPanel(id)) || bad("Talep bulunamadı.");
      else if (body.op === "delete") await deleteTicket(id);
      else bad("Bilinmeyen işlem.");
      return { ok: true };
    }

    /* ---------------- deleting data ---------------- */
    case "message_delete": {
      const { error } = await db().from("messages").delete().eq("id", int(body.id, 1, 1e15, 0));
      if (error) throw new Error(error.message);
      return { ok: true };
    }

    case "lead_wipe": {
      const id = String(body.id ?? "");
      const lead = (await getLeadById(id)) ?? bad("Kişi bulunamadı.");
      const mode = String(body.mode);
      if (mode === "messages") {
        await db().from("messages").delete().eq("lead_id", id);
      } else if (mode === "reset") {
        for (const table of ["messages", "lead_signals", "sales_events", "checkouts", "conversation_analyses", "conversation_reviews", "experiment_assignments", "support_tickets", "lead_profiles"]) {
          await db().from(table).delete().eq("lead_id", id); // tables from optional SQL updates may not exist → ignore errors
        }
        await db().from("lead_profiles").insert({ lead_id: id });
        await updateLead(id, {
          stage: "NEW", score: 0, playbook_version: null, user_turns: 0, pre_free_turns: 0, post_free_turns: 0, eligible_turns: 0,
          free_channel_invited: false, free_channel_invited_at: null, free_channel_joined: false, free_channel_joined_at: null,
          vip_offer_count: 0, vip_offer_last_at: null, plans_shown_count: 0, checkout_started: false, checkout_started_at: null, last_checkout_plan: null,
          opted_out: false, do_not_sell: false, do_not_sell_reason: null, needs_human: false, blocked: false,
          followup_count: 0, followups_since_reply: 0, followups_sent: [], last_followup_at: null, last_user_message_at: null, last_bot_message_at: null,
          outcome: lead.paid ? "won" : null, outcome_reason: lead.paid ? lead.outcome_reason : null, closed_at: lead.paid ? lead.closed_at : null, analyzed_at: null,
        });
      } else if (mode === "delete") {
        await db().rpc("refresh_daily_stats", { p_days: 3650 }); // freeze this person's numbers into the permanent daily snapshot first
        // Payments are accounting records: they stay, but anonymised. Everything else about the person goes (cascade).
        await db().from("payments").update({ email: null, raw: null }).eq("lead_id", id);
        const { error } = await db().from("leads").delete().eq("id", id);
        if (error) throw new Error(error.message);
      } else bad("Bilinmeyen işlem.");
      await recordEvent(null, "ADMIN_DATA_DELETED", { mode, lead: mode === "delete" ? "(deleted)" : id });
      return { ok: true };
    }

    case "bulk_delete": {
      const days = int(body.days, 0, 3650, 30);
      const cutoff = sinceDays(days);
      const del = async (q: any): Promise<number> => {
        const { count, error } = await q;
        if (error && !/does not exist|schema cache/i.test(error.message)) throw new Error(error.message);
        return count ?? 0;
      };
      const t = (table: string) => db().from(table).delete({ count: "exact" });
      const kind = String(body.kind);
      if (kind === "never_started" || kind === "lost") await db().rpc("refresh_daily_stats", { p_days: 3650 }); // analytics keep the history
      let deleted: Record<string, number> = {};
      if (kind === "never_started") deleted = { leads: await del(t("leads").is("telegram_user_id", null).lt("created_at", cutoff)) };
      else if (kind === "lost") deleted = { leads: await del(t("leads").eq("outcome", "lost").eq("paid", false).lt("updated_at", cutoff)) };
      else if (kind === "messages") deleted = { messages: await del(t("messages").lt("created_at", cutoff)) };
      else if (kind === "logs")
        deleted = {
          sales_events: await del(t("sales_events").lt("created_at", cutoff)), webhook_events: await del(t("webhook_events").lt("created_at", cutoff)),
          telegram_updates: await del(t("telegram_updates").lt("created_at", cutoff)), checkouts: await del(t("checkouts").lt("created_at", cutoff)),
        };
      else if (kind === "tickets") deleted = { support_tickets: await del(t("support_tickets").neq("status", "open").lt("created_at", cutoff)) };
      else if (kind === "analyses") deleted = { conversation_analyses: await del(t("conversation_analyses").not("batch_id", "is", null).lt("created_at", cutoff)) };
      else bad("Bilinmeyen işlem.");
      await recordEvent(null, "ADMIN_BULK_DELETE", { kind, days, deleted });
      return { deleted };
    }

    case "row_delete": {
      const table = String(body.table);
      const id = body.id as string | number;
      const spec: Record<string, { column: string; guard?: () => Promise<void> }> = {
        experiments: { column: "id", guard: async () => { if ((await rows(db().from("experiments").select("status").eq("id", id)))[0]?.status === "running") bad("Çalışan test silinemez. Önce durdurun."); } },
        playbooks: { column: "version", guard: async () => { if ((await rows(db().from("playbooks").select("status").eq("version", id)))[0]?.status === "active") bad("Yayındaki rehber silinemez."); } },
        learning_batches: { column: "id" }, conversation_analyses: { column: "lead_id" }, conversation_reviews: { column: "lead_id" },
        webhook_events: { column: "id" }, telegram_updates: { column: "update_id" }, payments: { column: "whop_payment_id" },
      };
      const rule = spec[table] ?? bad("Bu tablo panelden silinemez.");
      await rule.guard?.();
      const { error } = await db().from(table).delete().eq(rule.column, id);
      if (error) throw new Error(error.message);
      await recordEvent(null, "ADMIN_ROW_DELETED", { table, id });
      return { ok: true };
    }

    /* ---------------- system ---------------- */
    case "system": {
      const env = getEnv();
      const [usage, webhook, failedWhop, failedTelegram] = await Promise.all([
        db().rpc("db_usage").then((r) => r.data ?? null, () => null),
        tg<Record<string, unknown>>("getWebhookInfo", {}).catch((e) => ({ error: (e as Error).message })),
        rows(db().from("webhook_events").select("id, type, error, created_at").eq("status", "failed").order("created_at", { ascending: false }).limit(10)),
        rows(db().from("telegram_updates").select("update_id, error, attempts, created_at").eq("status", "failed").order("created_at", { ascending: false }).limit(10)),
      ]);
      return {
        envProblems: envProblems(), lastMetaError, usage, webhook, failedWhop, failedTelegram, appUrl: env.APP_URL, model: env.DEEPSEEK_MODEL,
        flags: { meta: Boolean(metaConfig().pixelId && metaConfig().token), metaTestMode: Boolean(metaConfig().testCode), whopApiKey: Boolean(env.WHOP_API_KEY), vipChannelId: Boolean(env.TELEGRAM_VIP_CHANNEL_ID), adminChat: Boolean(env.TELEGRAM_ADMIN_CHAT_ID), support: Boolean(settingsView().integrations.supportUsername || env.SUPPORT_USERNAME || env.SUPPORT_URL), ownPassword: Boolean(process.env.ADMIN_PASSWORD?.trim()), autoApprove: env.PLAYBOOK_AUTO_APPROVE },
      };
    }
    case "purge_now":
      await loadSettings(true);
      return { purged: (await purgeOldData()) ?? bad("Temizlik fonksiyonu bulunamadı. Supabase'de supabase/support_and_cleanup.sql dosyasını çalıştırın.") };
    case "register_webhook":
      return { webhook: await registerWebhook() };

    default:
      return bad("Bilinmeyen işlem.");
  }
}

export async function POST(request: NextRequest) {
  let env: Env;
  try {
    env = getEnv();
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "");

  if (action === "login") {
    if (!(await allowRequest(`admin-login:${clientIp(request) ?? "unknown"}`, 8, 900))) return NextResponse.json({ error: "Çok fazla deneme. 15 dakika sonra tekrar deneyin." }, { status: 429 });
    if (!safeEqual(String(body.password ?? ""), password(env))) return NextResponse.json({ error: "Şifre yanlış." }, { status: 401 });
    const exp = Date.now() + WEEK * 1000;
    const response = NextResponse.json({ ok: true });
    response.cookies.set(COOKIE, `${exp}.${sign(exp, env)}`, { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: WEEK });
    return response;
  }
  if (action === "logout") {
    const response = NextResponse.json({ ok: true });
    response.cookies.set(COOKIE, "", { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 0 });
    return response;
  }
  if (!isAuthed(request, env)) return NextResponse.json({ error: "Oturum yok." }, { status: 401 });

  try {
    await loadSettings();
    return NextResponse.json(await handle(action, body));
  } catch (error) {
    if (error instanceof SettingsError) return NextResponse.json({ error: error.problems.join("\n") }, { status: 400 });
    if (error instanceof PostError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("[admin]", action, error);
    return NextResponse.json({ error: `Sunucu hatası: ${(error as Error).message.slice(0, 400)}` }, { status: 500 });
  }
}
