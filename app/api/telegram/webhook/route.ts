import { loadSettings } from "@/src/lib/settings";
import { NextResponse, type NextRequest } from "next/server";
import { BUSINESS } from "@/src/config/business";
import { parsePostRef } from "@/src/sales/posts";
import { COMMANDS } from "@/src/config/commands";
import { getEnv } from "@/src/lib/env";
import { db } from "@/src/lib/supabase";
import { isAdminChat, notifyAdmin } from "@/src/lib/admin";
import { allowRequest } from "@/src/lib/rate-limit";
import { getLeadById, getLeadByTelegramId, recordEvent, recordMessage, updateLead, withLeadLock } from "@/src/lib/leads";
import { answerCallback, freeChannelKeyboard, isActiveMember, isMemberOf, sendText, type ChatMember } from "@/src/lib/telegram";
import { safeEqual } from "@/src/lib/util";
import { handleAdminCommand } from "@/src/sales/admin-commands";
import { handleFreeChannelJoined, handleOptOut, handlePlansCommand, handleStart, handleUserMessage, sendToLead, type TelegramUser } from "@/src/sales/engine";
import { isOptOut } from "@/src/sales/guardrails";
import { tx } from "@/src/config/texts";
import { handleAdminCallback, handleAdminReply, handleCustomerImage, routeToOpenTicket } from "@/src/sales/support";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Chat = { id: number; type: string; username?: string };
type Message = {
  message_id: number; from?: TelegramUser & { is_bot?: boolean }; chat: Chat; text?: string; caption?: string;
  photo?: unknown[]; document?: { mime_type?: string }; voice?: unknown; audio?: unknown; video_note?: unknown;
  reply_to_message?: { message_id: number };
};
type MemberUpdate = { chat: Chat; from: TelegramUser; old_chat_member: ChatMember; new_chat_member: ChatMember & { user: TelegramUser & { is_bot?: boolean } } };
type Update = {
  update_id: number;
  message?: Message;
  callback_query?: { id: string; from: TelegramUser; data?: string; message?: Message };
  chat_member?: MemberUpdate;
  my_chat_member?: MemberUpdate;
};

const sameChannel = (chat: Chat, configured: string | undefined) =>
  Boolean(configured) && (String(chat.id) === configured || (chat.username ? `@${chat.username}`.toLowerCase() === configured!.toLowerCase() : false));

/* ------------------------------------------------------------------ */

async function onChannelMembership(u: MemberUpdate): Promise<void> {
  const env = getEnv();
  const user = u.new_chat_member.user;
  if (user.is_bot) return;
  const was = isActiveMember(u.old_chat_member);
  const is = isActiveMember(u.new_chat_member);
  if (was === is) return;
  const lead = await getLeadByTelegramId(user.id);

  if (sameChannel(u.chat, env.TELEGRAM_FREE_CHANNEL_ID)) {
    if (!lead) return; // joined the channel without ever talking to the bot
    if (is) await withLeadLock(lead.id, async () => handleFreeChannelJoined((await getLeadById(lead.id)) ?? lead, "auto"));
    else await recordEvent(lead.id, "FREE_CHANNEL_LEFT");
    return;
  }
  if (sameChannel(u.chat, env.TELEGRAM_VIP_CHANNEL_ID)) {
    if (lead) await recordEvent(lead.id, is ? "VIP_CHANNEL_JOINED" : "VIP_CHANNEL_LEFT");
    const staff = ["creator", "administrator"].includes(u.new_chat_member.status);
    if (is && !staff && !lead?.vip_active) {
      await notifyAdmin(`⚠️ ${user.first_name ?? "Birisi"} (@${user.username ?? "-"}, id ${user.id}) aktif üyeliği OLMADAN VIP kanalına girdi. Link paylaşılmış olabilir.`);
    }
  }
}

async function onBotBlockedOrUnblocked(u: MemberUpdate): Promise<void> {
  if (u.chat.type !== "private") return;
  const lead = await getLeadByTelegramId(u.from.id);
  if (!lead) return;
  const blocked = u.new_chat_member.status === "kicked";
  await updateLead(lead.id, { blocked });
  if (blocked) await recordEvent(lead.id, "BOT_BLOCKED");
}

async function onCallback(q: NonNullable<Update["callback_query"]>, replied: () => Promise<void>): Promise<void> {
  if (q.data?.startsWith("tk:")) {
    // Support-ticket buttons only exist in the owner's chat.
    if (!q.message || !isAdminChat(q.message.chat.id)) return answerCallback(q.id);
    await replied();
    return handleAdminCallback(q);
  }
  if (q.data !== "check_free") return answerCallback(q.id);
  const lead = await getLeadByTelegramId(q.from.id);
  if (!lead) return answerCallback(q.id, "Envie /start para começar 🙂", true);
  if (lead.free_channel_joined) return answerCallback(q.id, "Zaten kanaldasın ✅");

  let member: boolean;
  try {
    member = await isMemberOf(getEnv().TELEGRAM_FREE_CHANNEL_ID, q.from.id);
  } catch (error) {
    await answerCallback(q.id, "Não consegui verificar agora. Tente de novo em instantes.", true);
    if (await allowRequest("alert:free-channel-check", 1, 3600)) {
      await notifyAdmin(`🚨 Ücretsiz kanal üyeliği doğrulanamıyor: ${(error as Error).message}. Botu ücretsiz kanalda YÖNETİCİ yap ve TELEGRAM_FREE_CHANNEL_ID değerini kontrol et.`);
    }
    return;
  }
  if (!member) {
    await recordEvent(lead.id, "FREE_JOIN_NOT_FOUND");
    return answerCallback(q.id, tx("joinNotFound").slice(0, 190), true);
  }
  await answerCallback(q.id, tx("joinConfirmed").slice(0, 190));
  await replied();
  await withLeadLock(lead.id, async () => handleFreeChannelJoined((await getLeadById(lead.id)) ?? lead, "button"));
}

async function onMessage(m: Message, replied: () => Promise<void>): Promise<void> {
  if (m.chat.type !== "private" || !m.from || m.from.is_bot) return;
  const from = m.from;
  if (!(await allowRequest(`tg:${from.id}`, 20, 60))) return; // flood: ignore silently

  // The owner answered a support ticket with Telegram's "reply" → goes to the customer (or becomes bot knowledge).
  if (isAdminChat(m.chat.id) && m.reply_to_message && (await handleAdminReply(m))) return replied();

  const text = m.text?.trim();
  if (!text) {
    const isAudio = Boolean(m.voice || m.audio || m.video_note);
    const isImage = Boolean(m.photo?.length || m.document?.mime_type?.startsWith("image/"));
    const lead = isAudio || isImage ? await getLeadByTelegramId(from.id) : null;
    if (lead && isAudio) {
      await sendToLead(lead, tx("audioReply"), { store: false });
      await recordMessage(lead.id, "event", "Kişi sesli mesaj gönderdi. Asistan ses dinleyemez; yazıyla yazmasını istedi.");
    } else if (lead && isImage) {
      await withLeadLock(lead.id, async () => handleCustomerImage((await getLeadById(lead.id)) ?? lead, m));
    } else if ((isAudio || isImage) && !lead) {
      return handleStart(from, m.chat.id, null, replied);
    } else {
      await sendText(m.chat.id, tx("nonTextReply"));
    }
    return replied();
  }

  if (isAdminChat(m.chat.id) && (await handleAdminCommand(m.chat.id, text))) return replied();

  const [first = ""] = text.split(/\s+/);
  const command = first.startsWith("/") ? first.toLowerCase().replace(/@\w+$/, "") : null;

  if (command === "/start") {
    const token = text.split(/\s+/)[1] ?? null;
    const post = parsePostRef(token);
    return handleStart(from, m.chat.id, !post && token && /^[A-Za-z0-9_-]{10,64}$/.test(token) ? token : null, replied, post);
  }

  const found = await getLeadByTelegramId(from.id);
  if (!found) return handleStart(from, m.chat.id, null, replied); // wrote without ever pressing /start

  await withLeadLock(found.id, async () => {
    const lead = (await getLeadById(found.id)) ?? found;
    if (lead.chat_id !== String(m.chat.id)) await updateLead(lead.id, { chat_id: String(m.chat.id) });

    if (command === `/${COMMANDS.stop}` || command === "/dur" || command === "/parar" || command === "/stop" || (!command && isOptOut(text))) {
      await recordMessage(lead.id, "user", text.slice(0, 200), m.message_id);
      await handleOptOut(lead);
    } else if (command === `/${COMMANDS.plans}` || command === "/planlar" || command === "/planos" || command === "/vip") {
      await recordMessage(lead.id, "user", text, m.message_id);
      await handlePlansCommand(lead);
    } else if (command === `/${COMMANDS.channel}` || command === "/kanal" || command === "/canal") {
      await recordMessage(lead.id, "user", text, m.message_id);
      if (lead.do_not_sell) await sendToLead(lead, tx("doNotSell"));
      else {
        await updateLead(lead.id, { free_channel_invited: true, free_channel_invited_at: lead.free_channel_invited_at ?? new Date().toISOString() });
        await sendToLead(lead, tx("canal"), { keyboard: freeChannelKeyboard() });
      }
    } else if (command) {
      await sendToLead(lead, tx("help"), { store: false });
    } else {
      // A human is handling this person (screenshot / asked for a human): pass the text on, keep the AI quiet.
      if (lead.needs_human && (await routeToOpenTicket(lead, text, m.message_id))) {
        await replied();
        return;
      }
      await handleUserMessage((await getLeadById(lead.id)) ?? lead, text, m.message_id, replied);
      return;
    }
    await replied();
  });
}

/* ------------------------------------------------------------------ */

export async function POST(request: NextRequest) {
  const env = getEnv();
  if (!safeEqual(request.headers.get("x-telegram-bot-api-secret-token"), env.TELEGRAM_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const update = (await request.json().catch(() => null)) as Update | null;
  if (!update || typeof update.update_id !== "number") return NextResponse.json({ ok: true });
  const id = update.update_id;
  await loadSettings();

  // ---- idempotency: Telegram re-sends an update until it gets a 2xx ----
  const { error: insertError } = await db().from("telegram_updates").insert({ update_id: id });
  if (insertError) {
    if (insertError.code !== "23505") return NextResponse.json({ error: "database unavailable" }, { status: 500 }); // Telegram retries
    const { data: seen } = await db().from("telegram_updates").select("status, reply_sent, attempts, updated_at").eq("update_id", id).maybeSingle();
    if (!seen || seen.status === "done" || seen.reply_sent || seen.attempts >= 3) return NextResponse.json({ ok: true });
    // Still being answered by an earlier delivery → ask Telegram to come back later instead of answering twice.
    if (seen.status === "processing" && Date.now() - new Date(seen.updated_at).getTime() < 90_000) {
      return NextResponse.json({ error: "in progress" }, { status: 503 });
    }
    await db().from("telegram_updates").update({ status: "processing", attempts: seen.attempts + 1, updated_at: new Date().toISOString() }).eq("update_id", id);
  }

  let replySent = false;
  const replied = async () => {
    if (replySent) return;
    replySent = true;
    await db().from("telegram_updates").update({ reply_sent: true, updated_at: new Date().toISOString() }).eq("update_id", id);
  };

  try {
    if (update.message) await onMessage(update.message, replied);
    else if (update.callback_query) await onCallback(update.callback_query, replied);
    else if (update.chat_member) await onChannelMembership(update.chat_member);
    else if (update.my_chat_member) await onBotBlockedOrUnblocked(update.my_chat_member);

    await db().from("telegram_updates").update({ status: "done", updated_at: new Date().toISOString() }).eq("update_id", id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = (error as Error).message?.slice(0, 500) ?? "unknown";
    console.error("[telegram webhook]", error);
    const { data: row } = await db().from("telegram_updates").update({ status: "failed", error: message, updated_at: new Date().toISOString() }).eq("update_id", id).select("attempts").maybeSingle();

    // The customer already got an answer → never retry (it would answer twice).
    if (replySent) return NextResponse.json({ ok: true });
    // Out of retries → apologise once instead of going silent, and tell the owner.
    if ((row?.attempts ?? 1) >= 3) {
      const chatId = update.message?.chat.type === "private" ? update.message.chat.id : undefined;
      if (chatId) await sendText(chatId, tx("technicalFallback")).catch(() => undefined);
      if (await allowRequest("alert:telegram-webhook", 3, 3600)) await notifyAdmin(`🚨 Telegram güncellemesi ${id} 3 kez başarısız oldu: ${message}`);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "retry" }, { status: 500 });
  }
}
