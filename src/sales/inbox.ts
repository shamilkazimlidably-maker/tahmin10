import { BUSINESS, renderFacts, supportContact } from "../config/business";
import { FUNNEL, SIGNALS, AI_SIGNAL_KEYS } from "../config/funnel";
import { INBOX } from "../config/inbox";
import { PROMPT_BLOCKS, PROMPT_TEXTS, fillPrompt } from "../config/prompts";
import { tx } from "../config/texts";
import { notifyAdmin } from "../lib/admin";
import { deepseekJson } from "../lib/deepseek";
import { getEnv } from "../lib/env";
import { applySignals, getLeadById, getProfile, mergeProfile, recordEvent, recordMessage, updateLead, type Lead } from "../lib/leads";
import { db } from "../lib/supabase";
import { freeChannelKeyboard, isMemberOf, sendText, tg, TelegramError, type InlineKeyboard } from "../lib/telegram";
import { hoursSince, truncate } from "../lib/util";
import { findForbiddenClaims } from "./guardrails";
import { presentPlans, sendToLead } from "./engine";

/**
 * GELEN KUTUSU — Intercom benzeri insan operatör modu.
 *  • Bota gelen her mesaj (yazı, ses, fotoğraf, video, dosya) panele düşer; sahip/operatör oradan cevaplar, cevap bot üzerinden gider.
 *  • Yapay zekâ cevap YAZMAZ; yalnızca yardım eder: puanlama/sinyal çıkarma, cevap önerisi, samimi Türkçeye çevirme,
 *    "kime cevap yazılmalı" listesi, her 10 konuşmada insan koçu raporu.
 *  • Sabit otomatik mesajlar kalır: karşılama + kanal düğmesi, "Katıldım" doğrulaması, komutlar, ödeme sonrası VIP linki.
 */

export type MediaKind = "photo" | "voice" | "audio" | "video" | "video_note" | "document" | "sticker";
export type InboundMedia = { kind: MediaKind; fileId: string; name?: string | null; caption?: string | null };

const PREVIEW: Record<MediaKind, string> = { photo: "📷 Fotoğraf", voice: "🎤 Sesli mesaj", audio: "🎵 Ses dosyası", video: "🎬 Video", video_note: "⚪ Video mesaj", document: "📎 Dosya", sticker: "🙂 Çıkartma" };

export const isHumanMode = () => INBOX.mode === "human";

/* ------------------------------------------------------------------ */
/*  Gelen mesaj                                                        */
/* ------------------------------------------------------------------ */

export async function recordInbound(lead: Lead, input: { text?: string | null; media?: InboundMedia | null; telegramMessageId: number }): Promise<boolean> {
  const content = input.media ? `${PREVIEW[input.media.kind]}${input.media.caption ? ` — ${input.media.caption}` : ""}${input.text ? ` ${input.text}` : ""}` : (input.text ?? "");
  const { error } = await db().from("messages").insert({
    lead_id: lead.id, role: "user", content: content.slice(0, 4000), telegram_message_id: input.telegramMessageId,
    media_type: input.media?.kind ?? null, media_file_id: input.media?.fileId ?? null, media_name: input.media?.name ?? null,
  });
  if (error) {
    if (error.code === "23505") return false; // Telegram tekrar denemesi
    throw new Error(`[inbox] recordInbound: ${error.message} — supabase/inbox.sql çalıştırıldı mı?`);
  }
  const now = new Date().toISOString();
  await updateLead(lead.id, {
    unread_count: (lead.unread_count ?? 0) + 1, last_message_at: now, last_message_preview: truncate(content, 120), inbox_status: "open",
    last_user_message_at: now, followups_since_reply: 0, blocked: false, user_turns: lead.user_turns + 1,
    ...(lead.stage === "NEW" ? { stage: "DISCOVERY" as const } : {}),
    ...(lead.outcome === "lost" && lead.outcome_reason === "went_silent" ? { outcome: null, outcome_reason: null, closed_at: null, analyzed_at: null } : {}),
  } as Partial<Lead>);
  await recordEvent(lead.id, "MESSAGE_RECEIVED", { length: content.length, stage: lead.stage, media: input.media?.kind ?? null });
  if (INBOX.notifyTelegram && hoursSince(lead.last_notified_at ?? null) * 60 >= INBOX.notifyCooldownMinutes) {
    await notifyAdmin(`💬 ${lead.first_name ?? "Kişi"}${lead.username ? ` (@${lead.username})` : ""}: “${truncate(content, 160)}”\nCevaplamak için: ${getEnv().APP_URL}/admin?tab=inbox&lead=${lead.id}`);
    await updateLead(lead.id, { last_notified_at: now } as Partial<Lead>).catch(() => undefined);
  }
  return true;
}

/** Yazılı mesajdan sinyal/profil çıkarır (cevap üretmez). Puanlama ve "kime yazılmalı" listesi buna dayanır. */
export async function extractSignals(lead: Lead, text: string): Promise<void> {
  try {
    const history = await recentForModel(lead.id, 8);
    const profile = await getProfile(lead.id);
    const { json } = await deepseekJson({
      messages: [
        { role: "system", content: PROMPT_TEXTS.signals + "\nSİNYALLER:\n" + SIGNALS.filter((s) => s.source === "ai").map((s) => `- ${s.key}: ${s.description}`).join("\n") },
        { role: "user", content: `SON KONUŞMA:\n${history}\n\nBİLİNEN PROFİL: ${JSON.stringify(profile ?? {})}\n\nKİŞİNİN SON MESAJI: ${text.slice(0, 1500)}` },
      ],
      temperature: 0.2, maxTokens: 900, thinking: false, timeoutMs: 20_000, retries: 0, label: "inbox-signals",
    });
    const out = (json ?? {}) as { signals?: Record<string, { value?: number; evidence?: string }>; profile_update?: Record<string, unknown>; objection?: string | null };
    const signals: Record<string, { value: number; evidence: string }> = {};
    for (const [k, v] of Object.entries(out.signals ?? {})) if (AI_SIGNAL_KEYS.includes(k) && v && Number(v.value) > 0) signals[k] = { value: Math.min(1, Number(v.value)), evidence: String(v.evidence ?? "").slice(0, 200) };
    if (Object.keys(signals).length) await applySignals(lead.id, signals, "ai");
    if (out.profile_update && typeof out.profile_update === "object") await mergeProfile(lead.id, { ...(out.profile_update as object), objection: out.objection ?? null });
  } catch (error) {
    console.error("[inbox] extractSignals:", error);
  }
}

/* ------------------------------------------------------------------ */
/*  Operatör cevabı                                                    */
/* ------------------------------------------------------------------ */

export async function sendAgentReply(leadId: string, text: string, options: { action?: "invite" | "plans" | null; allowClaims?: boolean } = {}): Promise<void> {
  const lead = await getLeadById(leadId);
  if (!lead?.chat_id) throw new Error("Bu kişinin botla bir Telegram sohbeti yok.");
  if (lead.blocked) throw new Error("Kişi botu engellemiş; mesaj iletilemez.");
  const final = text.trim();
  if (!final && !options.action) throw new Error("Mesaj boş.");
  if (final && !options.allowClaims) {
    const claims = findForbiddenClaims(final).filter((c) => c !== "raw_link");
    if (claims.length) throw new Error(`Metin yasak bir vaat içeriyor (${claims.join(", ")}). “banko / garanti / kesin / son yer” gibi ifadeler yanıltıcı reklamdır. Yine de göndermek için “uyarıya rağmen gönder”i işaretleyin.`);
  }
  let keyboard: InlineKeyboard | undefined;
  if (options.action === "invite") keyboard = freeChannelKeyboard();
  if (final) {
    try {
      await tg("sendMessage", { chat_id: lead.chat_id, text: final, link_preview_options: { is_disabled: true }, ...(keyboard ? { reply_markup: keyboard } : {}) });
    } catch (error) {
      if (error instanceof TelegramError && error.isBlocked) { await updateLead(lead.id, { blocked: true }); throw new Error("Kişi botu engellemiş; mesaj iletilemedi."); }
      throw error;
    }
    await db().from("messages").insert({ lead_id: lead.id, role: "assistant", content: final, agent: "agent" });
  }
  if (options.action === "invite") {
    if (!final) await sendToLead(lead, tx("canal"), { keyboard: freeChannelKeyboard() });
    await updateLead(lead.id, { free_channel_invited: true, free_channel_invited_at: lead.free_channel_invited_at ?? new Date().toISOString(), ...(lead.stage === "NEW" || lead.stage === "DISCOVERY" ? { stage: "FREE_INVITED" as const } : {}) });
    await recordEvent(lead.id, "FREE_INVITE_SHOWN", { by: "agent" });
  }
  if (options.action === "plans") await presentPlans(lead, "command");
  await updateLead(lead.id, { last_agent_reply_at: new Date().toISOString(), last_bot_message_at: new Date().toISOString(), unread_count: 0 } as Partial<Lead>);
  await recordEvent(lead.id, "AGENT_REPLY", { length: final.length, action: options.action ?? null });
}

export async function checkMembership(leadId: string): Promise<{ joined: boolean; vip: boolean }> {
  const lead = await getLeadById(leadId);
  if (!lead?.telegram_user_id) throw new Error("Kişi bulunamadı.");
  const env = getEnv();
  const joined = await isMemberOf(env.TELEGRAM_FREE_CHANNEL_ID, lead.telegram_user_id);
  const vip = env.TELEGRAM_VIP_CHANNEL_ID ? await isMemberOf(env.TELEGRAM_VIP_CHANNEL_ID, lead.telegram_user_id).catch(() => false) : lead.vip_active;
  if (joined && !lead.free_channel_joined) {
    await updateLead(lead.id, { free_channel_joined: true, free_channel_joined_at: new Date().toISOString(), free_channel_invited: true, ...(lead.stage === "NEW" || lead.stage === "DISCOVERY" || lead.stage === "FREE_INVITED" ? { stage: "ENGAGED" as const } : {}) });
    await recordEvent(lead.id, "FREE_JOIN_VERIFIED", { via: "agent_check" });
    await recordMessage(lead.id, "event", "Telegram doğruladı: kişi ücretsiz kanala girdi (panelden kontrol).");
  }
  if (!joined && lead.free_channel_joined) await updateLead(lead.id, { free_channel_joined: false }).catch(() => undefined);
  return { joined, vip };
}

/* ------------------------------------------------------------------ */
/*  Liste / konuşma / meta                                             */
/* ------------------------------------------------------------------ */

const LIST_COLS = "id, first_name, username, telegram_user_id, stage, score, unread_count, last_message_at, last_message_preview, last_agent_reply_at, last_user_message_at, inbox_status, tags, starred, note, free_channel_invited, free_channel_joined, vip_active, paid, checkout_started, last_checkout_plan, opted_out, blocked, do_not_sell, origin, origin_post_id, campaign, source, created_at, needs_human";

export async function listConversations(filter: { box?: string; tag?: string; q?: string; limit?: number }): Promise<Record<string, unknown>[]> {
  let query = db().from("leads").select(LIST_COLS).is("merged_into", null).not("telegram_user_id", "is", null).order("last_message_at", { ascending: false, nullsFirst: false }).limit(Math.min(300, filter.limit ?? 150));
  switch (filter.box) {
    case "unread": query = query.gt("unread_count", 0); break;
    case "waiting": query = query.gt("unread_count", 0).eq("inbox_status", "open"); break;
    case "starred": query = query.eq("starred", true); break;
    case "closed": query = query.eq("inbox_status", "closed"); break;
    case "joined": query = query.eq("free_channel_joined", true).eq("paid", false); break;
    case "checkout": query = query.eq("checkout_started", true).eq("paid", false); break;
    case "customers": query = query.eq("paid", true); break;
    case "hot": query = query.gte("score", FUNNEL.vipScoreThreshold).eq("paid", false); break;
    default: query = query.eq("inbox_status", "open");
  }
  if (filter.tag) query = query.contains("tags", [filter.tag]);
  if (filter.q) query = query.or(`first_name.ilike.%${filter.q.replace(/[%,]/g, "")}%,username.ilike.%${filter.q.replace(/[%,]/g, "")}%`);
  const { data, error } = await query;
  if (error) throw new Error(`${error.message} — supabase/inbox.sql çalıştırıldı mı?`);
  return (data ?? []) as Record<string, unknown>[];
}

export async function getConversation(leadId: string): Promise<{ lead: Record<string, unknown>; messages: Record<string, unknown>[]; profile: unknown; signals: unknown[] }> {
  const [lead, messages, profile, signals] = await Promise.all([
    db().from("leads").select(`${LIST_COLS}, landing_url, chat_id, playbook_version, post_free_turns, pre_free_turns, outcome, outcome_reason`).eq("id", leadId).maybeSingle(),
    db().from("messages").select("id, role, content, created_at, media_type, media_file_id, media_name, agent, telegram_message_id").eq("lead_id", leadId).order("id", { ascending: true }).limit(400),
    getProfile(leadId),
    db().from("lead_signals").select("signal_key, value, evidence, created_at").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(30),
  ]);
  if (!lead.data) throw new Error("Kişi bulunamadı.");
  return { lead: lead.data as Record<string, unknown>, messages: (messages.data ?? []) as Record<string, unknown>[], profile, signals: signals.data ?? [] };
}

export async function markRead(leadId: string): Promise<void> {
  await updateLead(leadId, { unread_count: 0 } as Partial<Lead>);
}

export async function updateMeta(leadId: string, patch: { tags?: string[]; starred?: boolean; inbox_status?: "open" | "closed"; note?: string | null }): Promise<void> {
  const clean: Record<string, unknown> = {};
  if (patch.tags) clean.tags = [...new Set(patch.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 12);
  if (typeof patch.starred === "boolean") clean.starred = patch.starred;
  if (patch.inbox_status === "open" || patch.inbox_status === "closed") clean.inbox_status = patch.inbox_status;
  if (patch.note !== undefined) clean.note = patch.note ? String(patch.note).slice(0, 2000) : null;
  await updateLead(leadId, clean as Partial<Lead>);
}

/* ------------------------------------------------------------------ */
/*  Yapay zekâ yardımcıları                                            */
/* ------------------------------------------------------------------ */

async function recentForModel(leadId: string, n: number): Promise<string> {
  const { data } = await db().from("messages").select("role, content, created_at, agent").eq("lead_id", leadId).order("id", { ascending: false }).limit(n);
  return ((data ?? []) as { role: string; content: string; agent: string | null }[]).reverse().map((m) => `${m.role === "user" ? "MÜŞTERİ" : m.role === "event" ? "SİSTEM" : m.agent ? "OPERATÖR" : "BOT"}: ${m.content}`).join("\n");
}

function personaBrief(): string {
  return [`# GÖREV\n${PROMPT_BLOCKS.mission}`, `# NASIL YAZARSIN\n${PROMPT_BLOCKS.style}`, `# İTİRAZLAR\n${PROMPT_BLOCKS.objections}`, `# DEĞİŞMEZ KURALLAR\n${fillPrompt(PROMPT_TEXTS.lockedRules)}`, `# BİLGİLER\n${renderFacts()}`].join("\n\n");
}

/** Operatör için cevap önerisi (gönderilmez; editöre konur). */
export async function suggestReply(leadId: string, hint?: string): Promise<{ suggestion: string; why: string; nextStep: string }> {
  const lead = await getLeadById(leadId);
  if (!lead) throw new Error("Kişi bulunamadı.");
  const [history, profile] = await Promise.all([recentForModel(leadId, 16), getProfile(leadId)]);
  const state = `DURUM: aşama ${lead.stage}, ilgi puanı ${lead.score}, kanalda: ${lead.free_channel_joined ? "evet" : "hayır"}, davet edildi: ${lead.free_channel_invited ? "evet" : "hayır"}, VIP: ${lead.vip_active ? "evet" : "hayır"}, ödeme sayfası açtı: ${lead.checkout_started ? "evet" : "hayır"}, satış yapma: ${lead.do_not_sell ? "EVET (" + lead.do_not_sell_reason + ")" : "hayır"}`;
  const { json } = await deepseekJson({
    messages: [
      { role: "system", content: `${personaBrief()}\n\n# ROL\nSen bir İNSAN satış operatörünün asistanısın. Operatör bu kişiye Telegram'dan yazacak; sen ona göndermesi için TEK bir cevap taslağı hazırlarsın. Operatörün sesiyle, "sen" diye, kısa (en fazla 3 satır), sıcak, satış baskısı olmadan. Link yazma; düğmeleri operatör ekler. Yalnızca json: {"suggestion":"...","why":"neden bu cevap (1 cümle)","next_step":"none | invite | plans | wait | handoff"}` },
      { role: "user", content: `${state}\nPROFİL: ${JSON.stringify(profile ?? {})}\n\nKONUŞMA:\n${history}${hint ? `\n\nOPERATÖRÜN NOTU: ${hint.slice(0, 300)}` : ""}` },
    ],
    temperature: 0.7, maxTokens: 700, thinking: false, timeoutMs: 40_000, retries: 1, label: "inbox-suggest",
  });
  const out = (json ?? {}) as { suggestion?: unknown; messages?: unknown; why?: unknown; next_step?: unknown };
  const suggestion = typeof out.suggestion === "string" ? out.suggestion : Array.isArray(out.messages) ? out.messages.map(String).join("\n") : "";
  if (!suggestion) throw new Error("Yapay zekâ öneri üretemedi; tekrar deneyin.");
  return { suggestion: suggestion.trim(), why: String(out.why ?? ""), nextStep: String(out.next_step ?? "none") };
}

/** Operatörün yazdığını istenen tona çevirir. */
export async function rewriteText(text: string, style: "samimi" | "kisa" | "resmi" | "ikna" = "samimi"): Promise<string> {
  const styles = { samimi: "Samimi, sıcak, doğal Türkçe; 'sen' diye; kısa cümleler; abartı ve baskı yok; en fazla 1 emoji.", kisa: "Aynı anlam, yarı uzunluk; gereksiz kelimeleri at.", resmi: "Nazik ve profesyonel, 'siz' diye; emoji yok.", ikna: "Aynı dürüst içerik; faydayı kişinin ihtiyacına bağla; garanti, banko, kesin, aciliyet gibi ifadeler ASLA; sonda tek bir yumuşak soru." };
  const { json } = await deepseekJson({
    messages: [
      { role: "system", content: `Sen bir Türkçe editörsün. Verilen mesajı şu tarza çevir: ${styles[style]} Anlamı, bilgileri ve sayıları değiştirme; yeni vaat ekleme; link ekleme. Yalnızca json: {"text":"..."}` },
      { role: "user", content: text.slice(0, 2000) },
    ],
    temperature: 0.5, maxTokens: 700, thinking: false, timeoutMs: 30_000, retries: 1, label: "inbox-rewrite",
  });
  const out = (json ?? {}) as { text?: unknown };
  if (typeof out.text !== "string" || !out.text.trim()) throw new Error("Çeviri üretilemedi; tekrar deneyin.");
  return out.text.trim();
}

/** "Bugün kime ne yazmalıyım?" — açık konuşmaları önceliklendirir. */
export async function todoList(): Promise<{ items: { lead_id: string; name: string; priority: number; reason: string; suggested_first_line: string }[]; generated_at: string }> {
  const rows = await listConversations({ box: "open", limit: 60 });
  const candidates = rows.filter((r) => !r.paid && !r.opted_out && !r.blocked && !r.do_not_sell).slice(0, 40);
  if (!candidates.length) return { items: [], generated_at: new Date().toISOString() };
  const lines = candidates.map((r) => `- id=${r.id} | ad=${r.first_name ?? "?"} | aşama=${r.stage} | puan=${r.score} | kanalda=${r.free_channel_joined ? "evet" : "hayır"} | ödeme sayfası=${r.checkout_started ? "evet" : "hayır"} | okunmamış=${r.unread_count} | son müşteri mesajı=${r.last_user_message_at ? Math.round(hoursSince(String(r.last_user_message_at))) + " saat önce" : "yok"} | son operatör cevabı=${r.last_agent_reply_at ? Math.round(hoursSince(String(r.last_agent_reply_at))) + " saat önce" : "yok"} | önizleme="${String(r.last_message_preview ?? "").slice(0, 80)}"`);
  const { json } = await deepseekJson({
    messages: [
      { role: "system", content: `Sen Türk futbol tahmin aboneliği satan küçük bir işletmenin satış yöneticisisin. Operatörün bugün kimlere yazması gerektiğini önceliklendir. Kurallar: okunmamış mesajı olanlar önce; ödeme sayfasını açıp almayanlar ve puanı yüksek olanlar sonra; kanala girmemişlere kanal hatırlatması; 3 günden uzun sessiz kalanları en sona. En fazla 15 kişi. Baskı, aciliyet, garanti yok. Yalnızca json: {"items":[{"lead_id":"...","priority":1,"reason":"neden (kısa)","suggested_first_line":"operatörün yazabileceği ilk cümle (samimi Türkçe)"}]}` },
      { role: "user", content: `KİŞİLER:\n${lines.join("\n")}` },
    ],
    temperature: 0.4, maxTokens: 2500, thinking: false, timeoutMs: 60_000, retries: 1, label: "inbox-todo",
  });
  const out = (json ?? {}) as { items?: { lead_id?: unknown; priority?: unknown; reason?: unknown; suggested_first_line?: unknown }[] };
  const byId = new Map(candidates.map((r) => [String(r.id), r]));
  const items = (out.items ?? []).filter((i) => byId.has(String(i.lead_id))).slice(0, 15).map((i, idx) => ({ lead_id: String(i.lead_id), name: String(byId.get(String(i.lead_id))!.first_name ?? "?"), priority: Number(i.priority) || idx + 1, reason: String(i.reason ?? ""), suggested_first_line: String(i.suggested_first_line ?? "") }));
  return { items, generated_at: new Date().toISOString() };
}

/** İnsan koçu: son konuşmalardan "böyle yazınca böyle oluyor" raporu. app_state.human_coach içinde son 5 rapor tutulur. */
export async function humanCoach(): Promise<Record<string, unknown>> {
  const { data } = await db().from("leads").select("id, first_name, stage, score, paid, free_channel_joined, checkout_started, outcome, outcome_reason, last_message_at").is("merged_into", null).not("telegram_user_id", "is", null).not("last_agent_reply_at", "is", null).order("last_message_at", { ascending: false }).limit(12);
  const leads = (data ?? []) as { id: string; first_name: string | null; stage: string; score: number; paid: boolean; free_channel_joined: boolean; checkout_started: boolean; outcome: string | null }[];
  if (leads.length < 3) throw new Error("Analiz için operatörün cevap yazdığı en az 3 konuşma gerekli.");
  const transcripts: string[] = [];
  for (const l of leads) transcripts.push(`### ${l.first_name ?? l.id} — aşama ${l.stage}, puan ${l.score}, kanalda ${l.free_channel_joined ? "evet" : "hayır"}, ödeme sayfası ${l.checkout_started ? "evet" : "hayır"}, SATIN ALDI: ${l.paid ? "EVET" : "hayır"}\n${(await recentForModel(l.id, 30)).slice(0, 2500)}`);
  const { json } = await deepseekJson({
    messages: [
      { role: "system", content: PROMPT_TEXTS.humanCoach },
      { role: "user", content: `İŞLETME BİLGİLERİ:\n${renderFacts().slice(0, 2500)}\n\nKONUŞMALAR (${leads.length}):\n${transcripts.join("\n\n").slice(0, 60000)}` },
    ],
    temperature: 0.4, maxTokens: 4000, thinking: true, timeoutMs: 170_000, retries: 1, label: "human-coach",
  });
  const report = (json && typeof json === "object" ? json : { ozet: "Rapor üretilemedi; tekrar deneyin." }) as Record<string, unknown>;
  const entry = { at: new Date().toISOString(), conversations: leads.length, report };
  const { data: row } = await db().from("app_state").select("value").eq("key", "human_coach").maybeSingle();
  const history = [entry, ...(Array.isArray(row?.value) ? row.value : [])].slice(0, 5);
  await db().from("app_state").upsert({ key: "human_coach", value: history, updated_at: new Date().toISOString() }, { onConflict: "key" });
  return entry;
}

export async function coachHistory(): Promise<unknown[]> {
  const { data } = await db().from("app_state").select("value").eq("key", "human_coach").maybeSingle();
  return Array.isArray(data?.value) ? data.value : [];
}

/* ------------------------------------------------------------------ */
/*  Hazır cevaplar / etiketler                                         */
/* ------------------------------------------------------------------ */

export async function cannedList(): Promise<unknown[]> {
  const { data } = await db().from("canned_replies").select("*").order("category").order("title");
  return data ?? [];
}
export async function cannedSave(input: { id?: number; title: string; shortcut?: string | null; text: string; action?: string | null; category?: string }): Promise<void> {
  const values = { title: String(input.title).trim().slice(0, 80), shortcut: input.shortcut ? String(input.shortcut).trim().toLowerCase().replace(/[^a-z0-9ğüşıöç_-]/g, "").slice(0, 30) || null : null, text: String(input.text).trim().slice(0, 3000), action: input.action === "invite" || input.action === "plans" ? input.action : null, category: String(input.category ?? "").trim().slice(0, 40), updated_at: new Date().toISOString() };
  if (!values.title || !values.text) throw new Error("Başlık ve metin gerekli.");
  const { error } = input.id ? await db().from("canned_replies").update(values).eq("id", input.id) : await db().from("canned_replies").insert(values);
  if (error) throw new Error(error.message);
}
export async function cannedDelete(id: number): Promise<void> { await db().from("canned_replies").delete().eq("id", id); }
export async function cannedUsed(id: number): Promise<void> {
  const { data } = await db().from("canned_replies").select("uses").eq("id", id).maybeSingle();
  if (data) await db().from("canned_replies").update({ uses: Number(data.uses ?? 0) + 1 }).eq("id", id);
}
export async function tagsList(): Promise<unknown[]> {
  const { data } = await db().from("inbox_tags").select("*").order("position").order("name");
  return data ?? [];
}
export async function tagSave(input: { id?: number; name: string; color?: string }): Promise<void> {
  const name = String(input.name).trim().toLowerCase().slice(0, 30);
  if (!name) throw new Error("Etiket adı gerekli.");
  const color = /^#[0-9a-f]{6}$/i.test(String(input.color ?? "")) ? String(input.color) : "#1f6fd1";
  const { error } = input.id ? await db().from("inbox_tags").update({ name, color }).eq("id", input.id) : await db().from("inbox_tags").insert({ name, color });
  if (error) throw new Error(error.message);
}
export async function tagDelete(id: number): Promise<void> { await db().from("inbox_tags").delete().eq("id", id); }

/** Telegram dosyasını (fotoğraf, ses…) indirip tarayıcıya akıtır. */
export async function fetchTelegramFile(fileId: string): Promise<{ bytes: ArrayBuffer; contentType: string; name: string }> {
  const env = getEnv();
  const info = await tg<{ file_path?: string }>("getFile", { file_id: fileId });
  if (!info.file_path) throw new Error("Dosya bulunamadı (Telegram dosyaları ~1 saat sonra yeniden istenmelidir).");
  const res = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${info.file_path}`);
  if (!res.ok) throw new Error(`Telegram dosya indirme ${res.status}`);
  const ext = info.file_path.split(".").pop()?.toLowerCase() ?? "";
  const types: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", oga: "audio/ogg", ogg: "audio/ogg", opus: "audio/ogg", mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "video/mp4", mov: "video/quicktime", pdf: "application/pdf", tgs: "application/gzip" };
  return { bytes: await res.arrayBuffer(), contentType: types[ext] ?? res.headers.get("content-type") ?? "application/octet-stream", name: info.file_path.split("/").pop() ?? "file" };
}

export const supportLabel = () => supportContact()?.label ?? null;
export const brand = () => BUSINESS.brand;
export const sendPlain = sendText;
