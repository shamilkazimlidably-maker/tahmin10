import { BUSINESS, supportContact } from "../config/business";
import { DIRECT_BUYING_REGEX, DIRECT_BUYING_SIGNALS, FUNNEL, META_EVENTS } from "../config/funnel";
import { notifyAdmin } from "../lib/admin";
import {
  applySignals,
  createLead,
  getLeadById,
  getLeadByTelegramId,
  getLeadByToken,
  getProfile,
  getRecentMessages,
  mergeLeads,
  mergeProfile,
  recordEvent,
  recordMessage,
  setSystemSignal,
  updateLead,
  type Lead,
} from "../lib/leads";
import { sendMetaEvent } from "../lib/meta";
import { freeChannelKeyboard, plansKeyboard, sendText, sendTyping, TelegramError, type InlineKeyboard } from "../lib/telegram";
import { hoursSince, sleep } from "../lib/util";
import { assignExperiments, getLiveInstructions } from "../learning/experiments";
import { getActivePlaybook } from "../learning/playbook";
import { permissionsFor, runSalesAgent, stageOf, type AgentOutput, type NextAction } from "./agent";
import { TEXTS, tx } from "../config/texts";
import { openTicket } from "./support";

export type TelegramUser = { id: number; first_name?: string; username?: string; language_code?: string };

/* ------------------------------------------------------------------ */
/*  Sending                                                           */
/* ------------------------------------------------------------------ */

/** Sends + stores a bot message. Returns false (and flags the lead) if the person blocked the bot. */
export async function sendToLead(
  lead: Lead,
  text: string,
  options: { keyboard?: InlineKeyboard; html?: boolean; store?: boolean } = {},
): Promise<boolean> {
  if (!lead.chat_id) return false;
  try {
    await sendText(lead.chat_id, text, options);
  } catch (error) {
    if (error instanceof TelegramError && error.isBlocked) {
      await updateLead(lead.id, { blocked: true });
      await recordEvent(lead.id, "BOT_BLOCKED");
      return false;
    }
    throw error;
  }
  if (options.store !== false) await recordMessage(lead.id, "assistant", text);
  await updateLead(lead.id, { last_bot_message_at: new Date().toISOString() });
  return true;
}

function plansText(): string {
  const lines = BUSINESS.plans.map((p) => `• ${p.name} — ${p.priceLabel}`);
  return `${tx("plansIntro")}\n\n${lines.join("\n")}\n\n${tx("plansFooter")}`;
}

export async function presentPlans(lead: Lead, reason: "offer_vip" | "show_plans" | "command" | "followup"): Promise<void> {
  // State is written BEFORE sending: if anything fails afterwards we can never double-offer.
  const proactive = reason === "offer_vip";
  const first = lead.vip_offer_count === 0;
  const updated = await updateLead(lead.id, {
    vip_offer_count: proactive ? lead.vip_offer_count + 1 : Math.max(1, lead.vip_offer_count),
    plans_shown_count: lead.plans_shown_count + 1,
    vip_offer_last_at: new Date().toISOString(),
    stage: lead.checkout_started ? "CHECKOUT" : "VIP_OFFERED",
    // Someone who said "no" and now asks for plans has re-opened the door themselves.
    ...(lead.outcome === "lost" ? { outcome: null, outcome_reason: null, closed_at: null, analyzed_at: null } : {}),
  });
  await sendToLead(updated, plansText(), { keyboard: plansKeyboard(lead.start_token), store: false });
  await recordMessage(lead.id, "event", `VIP planları düğmelerle gönderildi (${reason}).`);
  await recordEvent(lead.id, proactive ? "VIP_OFFER_SHOWN" : "VIP_PLANS_SHOWN", { reason, score: lead.score });
  if (first) {
    await sendMetaEvent({ ...META_EVENTS.vipOfferShown, eventId: `vipoffer_${lead.id}`, lead });
  }
}

/* ------------------------------------------------------------------ */
/*  One conversational turn                                            */
/* ------------------------------------------------------------------ */

type TurnOptions = {
  /** Present when the turn answers a real user message. */
  userText?: string;
  /** Present for system-triggered turns (start, channel join). */
  directive?: string;
  onReplied?: () => Promise<void>;
};

function directBuyingIntent(output: AgentOutput, userText: string | undefined): boolean {
  if (!userText) return false;
  const fromModel = DIRECT_BUYING_SIGNALS.some((key) => Number(output.signals[key]?.value ?? 0) >= 0.5);
  return fromModel || DIRECT_BUYING_REGEX.test(userText);
}

function resolveAction(output: AgentOutput, lead: Lead, userText: string | undefined): NextAction {
  const p = permissionsFor(lead);
  const direct = directBuyingIntent(output, userText);
  let action = output.next_action;

  if (output.risk_flag || lead.do_not_sell) {
    return action === "handoff_human" ? action : "none";
  }
  if (action === "invite_free") {
    const resend = lead.free_channel_invited && !lead.free_channel_joined;
    if (!(p.inviteAllowed || resend)) action = "none";
  }
  if (action === "offer_vip" && !p.offerAllowed) action = direct && p.plansAllowed ? "show_plans" : "none";
  if (action === "show_plans" && !(p.plansAllowed && (direct || p.offerAllowed))) action = "none";

  // The model answered a clear price / "quero assinar" message but forgot the buttons.
  const strong = ["asks_about_price", "explicit_purchase_intent"].some((k) => Number(output.signals[k]?.value ?? 0) >= 1);
  if (action === "none" && strong && p.plansAllowed && userText) action = "show_plans";

  return action;
}

export async function runTurn(leadId: string, options: TurnOptions): Promise<void> {
  let lead = await getLeadById(leadId);
  if (!lead || !lead.chat_id) return;

  const stage = stageOf(lead);
  const [profile, history, playbook, experiments] = await Promise.all([
    getProfile(lead.id),
    getRecentMessages(lead.id, FUNNEL.historyMessages),
    getActivePlaybook(),
    getLiveInstructions(lead.id, stage),
  ]);
  if (lead.playbook_version === null) lead = await updateLead(lead.id, { playbook_version: playbook.version });

  await sendTyping(lead.chat_id!);

  let output: AgentOutput;
  try {
    output = await runSalesAgent({
      lead,
      profile,
      history,
      playbook,
      experiments,
      stage,
      permissions: permissionsFor(lead),
      directive: options.directive,
    });
  } catch (error) {
    console.error("[engine] agent failed:", error);
    await sendToLead(lead, tx("technicalFallback"), { store: false });
    await options.onReplied?.();
    await recordEvent(lead.id, "AGENT_ERROR", { message: (error as Error).message.slice(0, 300) });
    await notifyAdmin(`🚨 ${lead.first_name ?? lead.id} için satış asistanı hatası: ${(error as Error).message.slice(0, 300)}`);
    return;
  }

  /* ---- 1. safety flags --------------------------------------------- */
  if (output.risk_flag && !lead.do_not_sell) {
    lead = await updateLead(lead.id, { do_not_sell: true, do_not_sell_reason: output.risk_flag });
    await recordEvent(lead.id, "RISK_FLAG", { flag: output.risk_flag });
    await sendMetaEvent({ ...META_EVENTS.doNotTarget, eventId: `dnt_${lead.id}`, lead });
    await notifyAdmin(`🛑 ${lead.first_name ?? lead.id} "${output.risk_flag}" olarak işaretlendi. Bu kişi için satış ve takip mesajları KAPATILDI.`);
  }
  if (output.guardrailHits.length) {
    await recordEvent(lead.id, "GUARDRAIL_HIT", { hits: output.guardrailHits });
  }

  /* ---- 2. evidence → score, memory ---------------------------------- */
  if (options.userText) {
    await applySignals(lead.id, output.signals, "ai");
    await mergeProfile(lead.id, { ...output.profile_update, objection: output.objection });
    if (output.objection) await recordEvent(lead.id, "OBJECTION", { type: output.objection, text: options.userText.slice(0, 300) });
    lead = (await getLeadById(lead.id)) ?? lead;
  }

  /* ---- 3. the backend decides what actually happens ----------------- */
  const action = resolveAction(output, lead, options.userText);
  if (action !== output.next_action) {
    await recordEvent(lead.id, "ACTION_OVERRIDDEN", { proposed: output.next_action, executed: action, score: lead.score });
  }

  /* ---- 4. deliver ---------------------------------------------------- */
  const lastIndex = output.messages.length - 1;
  for (let i = 0; i <= lastIndex; i++) {
    const keyboard = action === "invite_free" && i === lastIndex ? freeChannelKeyboard() : undefined;
    if (i > 0) {
      await sendTyping(lead.chat_id!);
      await sleep(700);
    }
    const delivered = await sendToLead(lead, output.messages[i]!, { keyboard });
    if (i === 0) await options.onReplied?.();
    if (!delivered) return;
  }

  /* ---- 5. side effects of the action -------------------------------- */
  if (action === "invite_free" && !lead.free_channel_invited) {
    lead = await updateLead(lead.id, { free_channel_invited: true, free_channel_invited_at: new Date().toISOString(), stage: "FREE_INVITED" });
    await recordMessage(lead.id, "event", "Ücretsiz kanal daveti düğmeyle gönderildi.");
    await recordEvent(lead.id, "FREE_INVITE_SHOWN", { by: "agent" });
  }
  if (action === "offer_vip" || action === "show_plans") {
    await presentPlans(lead, action);
    lead = (await getLeadById(lead.id)) ?? lead;
  }
  if (action === "stop_selling") {
    lead = await updateLead(lead.id, {
      stage: "NOT_INTERESTED",
      outcome: "lost",
      outcome_reason: "explicit_no",
      closed_at: new Date().toISOString(),
    });
    await applySignals(lead.id, { explicit_no: { value: 1, evidence: (options.userText ?? "").slice(0, 200) } }, "ai");
    await recordEvent(lead.id, "NOT_INTERESTED");
    await sendMetaEvent({ ...META_EVENTS.notInterested, eventId: `notinterested_${lead.id}`, lead });
  }
  if (action === "handoff_human") {
    const support = supportContact();
    if (support) {
      await sendToLead(lead, tx("handoffContact", { support: support.label }), {
        keyboard: support.url ? { inline_keyboard: [[{ text: TEXTS.btnSupport, url: support.url }]] } : undefined,
      });
    }
  }
  if (action === "handoff_human" && !lead.needs_human) {
    await recordEvent(lead.id, "HANDOFF_REQUESTED");
    // Opens a support ticket: the owner gets it in Telegram with Reply / Solved buttons and the AI stays
    // quiet for this person until it is solved (or auto-released). See src/sales/support.ts.
    const ticket = await openTicket(lead, { reason: "handoff", text: options.userText });
    if (!ticket) {
      await notifyAdmin(`🙋 ${lead.first_name ?? "Kişi"} (@${lead.username ?? "-"}, id ${lead.telegram_user_id}) bir insanla konuşmak istiyor.\nSon mesajı: "${(options.userText ?? "").slice(0, 300)}"\nCevaplamak için: /say ${lead.telegram_user_id} <metin>`);
    }
    lead = await updateLead(lead.id, { needs_human: true });
  }

  /* ---- 6. safety net: the free invite must not be forgotten ---------- */
  const p = permissionsFor(lead);
  if (p.inviteDue && !["invite_free", "stop_selling", "handoff_human"].includes(action) && !output.risk_flag) {
    const text = tx("freeInviteFallback");
    lead = await updateLead(lead.id, { free_channel_invited: true, free_channel_invited_at: new Date().toISOString(), stage: "FREE_INVITED" });
    await sendToLead(lead, text, { keyboard: freeChannelKeyboard() });
    await recordEvent(lead.id, "FREE_INVITE_SHOWN", { by: "backend" });
  }

  /* ---- 7. bookkeeping ------------------------------------------------ */
  const fresh = (await getLeadById(lead.id)) ?? lead;
  const stillEligible = permissionsFor(fresh).offerAllowed;
  await updateLead(fresh.id, {
    eligible_turns: stillEligible ? fresh.eligible_turns + 1 : 0,
    stage: fresh.stage === "NOT_INTERESTED" ? "NOT_INTERESTED" : stageOf(fresh),
  });
}

/* ------------------------------------------------------------------ */
/*  Entry points used by the webhook                                   */
/* ------------------------------------------------------------------ */

export async function handleStart(from: TelegramUser, chatId: number, token: string | null, onReplied?: () => Promise<void>): Promise<void> {
  const existing = await getLeadByTelegramId(from.id);
  let fromLink = token ? await getLeadByToken(token) : null;

  // Someone forwarded their personal link to a friend: same ad attribution, but a NEW person.
  if (fromLink?.telegram_user_id && fromLink.telegram_user_id !== String(from.id)) {
    fromLink = existing
      ? null
      : await createLead({
          source: fromLink.source,
          medium: fromLink.medium ?? "shared_link",
          campaign: fromLink.campaign,
          adset: fromLink.adset,
          ad: fromLink.ad,
        });
  }

  let lead: Lead;
  if (existing && fromLink && existing.id !== fromLink.id) lead = await mergeLeads(existing, fromLink);
  else lead = existing ?? fromLink ?? (await createLead({ source: "telegram_direct" }));

  const firstStart = !lead.telegram_user_id;
  lead = await updateLead(lead.id, {
    telegram_user_id: String(from.id),
    chat_id: String(chatId),
    first_name: from.first_name?.slice(0, 64) ?? lead.first_name,
    username: from.username ?? lead.username,
    language_code: from.language_code ?? lead.language_code,
    blocked: false,
    opted_out: false,
  });

  if (firstStart) {
    await assignExperiments(lead.id);
    await recordEvent(lead.id, "TELEGRAM_STARTED", { campaign: lead.campaign, ad: lead.ad });
    await sendMetaEvent({ ...META_EVENTS.botStarted, eventId: `lead_${lead.id}`, lead, contentName: "telegram_bot_started" });
  }
  await recordMessage(lead.id, "event", firstStart ? "Kişi botu ilk kez açtı (/start)." : "Kişi yeniden /start gönderdi.");

  if (lead.vip_active) {
    await sendToLead(lead, tx("alreadyVipStart"));
    await onReplied?.();
    return;
  }

  await runTurn(lead.id, {
    onReplied,
    directive:
      lead.user_turns > 0
        ? "Kişi geri döndü ve yeniden /start'a bastı. Tek satırda tekrar hoş geldin de ve PROFİL'i kullanarak kaldığınız yerden devam et. Sıfırdan başlama."
        : "İlk temas. Tek satırda selam ver (varsa ilk adıyla) ve futbolla ilgili hafif BİR soru sor. Henüz kanaldan da VIP'ten de söz etme.",
  });
}

export async function handleUserMessage(lead: Lead, text: string, telegramMessageId: number, onReplied?: () => Promise<void>): Promise<void> {
  const isNew = await recordMessage(lead.id, "user", text.slice(0, 2000), telegramMessageId);
  if (!isNew) return; // Telegram retry of a message we already have.

  const patch: Partial<Lead> = {
    user_turns: lead.user_turns + 1,
    last_user_message_at: new Date().toISOString(),
    followups_since_reply: 0,
    blocked: false,
  };
  if (lead.free_channel_joined) patch.post_free_turns = lead.post_free_turns + 1;
  else patch.pre_free_turns = lead.pre_free_turns + 1;
  if (lead.stage === "NEW") patch.stage = "DISCOVERY";
  // A lead we had closed as "went silent" is talking again → re-open it.
  if (lead.outcome === "lost" && lead.outcome_reason === "went_silent") {
    Object.assign(patch, { outcome: null, outcome_reason: null, closed_at: null, analyzed_at: null });
  }
  const returning = lead.last_user_message_at && hoursSince(lead.last_user_message_at) >= 12;
  await updateLead(lead.id, patch);
  if (returning) await setSystemSignal(lead.id, "returned_to_bot", "Wrote again 12h+ after the previous message.");
  await recordEvent(lead.id, "MESSAGE_RECEIVED", { length: text.length, stage: lead.stage });

  await runTurn(lead.id, { userText: text, onReplied });
}

export async function handleFreeChannelJoined(lead: Lead, via: "button" | "auto"): Promise<void> {
  if (lead.free_channel_joined) return;
  lead = await updateLead(lead.id, {
    free_channel_invited: true,
    free_channel_joined: true,
    free_channel_joined_at: new Date().toISOString(),
    stage: "ENGAGED",
  });
  await setSystemSignal(lead.id, "joined_free_channel", `Membership verified by Telegram (${via}).`);
  await recordEvent(lead.id, "FREE_JOIN_VERIFIED", { via });
  await recordMessage(lead.id, "event", "Telegram doğruladı: kişi ücretsiz kanala girdi.");
  await sendMetaEvent({ ...META_EVENTS.freeJoined, eventId: `registration_${lead.id}`, lead, contentName: "free_channel", customData: { status: true } });

  if (!lead.chat_id || lead.blocked || lead.opted_out) return;
  await runTurn(lead.id, {
    directive:
      "Sistem kişinin ücretsiz kanala girdiğini doğruladı. Tek satırda hoş geldin de, orada ne bulacağını söyle (yalnızca BİLGİLER'de olanı) ve futbolla ilgili BİR soru sor. VIP'ten söz etme.",
  });
}

export async function handleOptOut(lead: Lead): Promise<void> {
  await updateLead(lead.id, { opted_out: true });
  await recordEvent(lead.id, "OPTED_OUT");
  await sendMetaEvent({ ...META_EVENTS.doNotTarget, eventId: `dnt_${lead.id}`, lead });
  await sendToLead(lead, tx("optOutDone"));
}

export async function handlePlansCommand(lead: Lead): Promise<void> {
  if (lead.vip_active) {
    await sendToLead(lead, tx("alreadyVip"));
    return;
  }
  if (lead.do_not_sell) {
    await sendToLead(lead, tx("doNotSell"));
    return;
  }
  await presentPlans(lead, "command");
}
