import { SUPPORT } from "../config/funnel";
import { supportContact } from "../config/business";
import { tx } from "../config/texts";
import { PROMPT_TEXTS } from "../config/prompts";
import { deepseekJson } from "../lib/deepseek";
import { getEnv } from "../lib/env";
import { getLeadById, getRecentMessages, recordEvent, recordMessage, updateLead, type Lead } from "../lib/leads";
import { addKnowledge, SettingsError } from "../lib/settings";
import { db } from "../lib/supabase";
import { answerCallback, sendText, tg, TelegramError, type InlineKeyboard } from "../lib/telegram";
import { hoursSince, truncate } from "../lib/util";

/**
 * DESTEK TALEPLERİ — sahip müşterilere kendi Telegram'ından cevap verir.
 *
 *  müşteri ekran görüntüsü gönderir / insan ister
 *      → talep açılır, bu kişi için yapay zekâ susar, sahibe mesaj düğmelerle gider
 *  sahip "Cevapla"ya basar (ya da mesaja Telegram'ın "yanıtla"sıyla yazar) → metin müşteriye gider
 *  müşteri cevap verir → yine sahibe düşer ("çözüldü mü?")
 *  sahip "Çözüldü"ye basar → yapay zekâ devralır
 *  sahip "Yapay zekâya öğret"e basar → sorun + çözüm bot bilgisi olur (src/config/prompts.ts → SUPPORT_KB)
 *
 * SUPPORT.autoReleaseHours boyunca kimsenin dokunmadığı talep otomatik serbest bırakılır;
 * sahip uyurken müşteri sessizlikte kalmaz.
 */

export type Ticket = { id: number; lead_id: string; status: "open" | "solved" | "expired"; reason: string | null; last_activity_at: string };
type Mode = "reply" | "teach";

const adminChat = () => getEnv().TELEGRAM_ADMIN_CHAT_ID ?? null;
const who = (lead: Lead) => `${lead.first_name ?? "Müşteri"}${lead.username ? ` (@${lead.username})` : ""}`;
const buttons = (id: number): InlineKeyboard => ({
  inline_keyboard: [
    [{ text: "✍️ Cevapla", callback_data: `tk:reply:${id}` }, { text: "✅ Çözüldü", callback_data: `tk:done:${id}` }],
    [{ text: "🧠 Yapay zekâya öğret (sorun + çözüm)", callback_data: `tk:teach:${id}` }],
  ],
});

async function remember(messageId: number | undefined, ticketId: number, mode: Mode): Promise<void> {
  if (!messageId) return;
  const { error } = await db().from("support_admin_messages").upsert({ message_id: messageId, ticket_id: ticketId, mode }, { onConflict: "message_id" });
  if (error) console.error("[support] remember:", error.message);
}

async function toAdmin(ticketId: number, text: string, mode: Mode, markup?: Record<string, unknown>): Promise<void> {
  const chat = adminChat();
  if (!chat) return;
  try {
    const sent = await tg<{ message_id: number }>("sendMessage", { chat_id: chat, text: truncate(text, 3900), link_preview_options: { is_disabled: true }, ...(markup ? { reply_markup: markup } : {}) });
    await remember(sent.message_id, ticketId, mode);
  } catch (error) {
    console.error("[support] toAdmin:", error);
  }
}

export async function getOpenTicket(leadId: string): Promise<Ticket | null> {
  const { data, error } = await db().from("support_tickets").select("id, lead_id, status, reason, last_activity_at").eq("lead_id", leadId).eq("status", "open").order("id", { ascending: false }).limit(1);
  if (error) {
    console.error("[support] getOpenTicket:", error.message, "— supabase/support_and_cleanup.sql çalıştırıldı mı?");
    return null;
  }
  return (data?.[0] as Ticket | undefined) ?? null;
}

const touch = (id: number) => db().from("support_tickets").update({ last_activity_at: new Date().toISOString() }).eq("id", id);

/** Talep sistemi çalışamıyorsa (yönetici sohbeti tanımsız ya da SQL güncellemesi yapılmamış) null döner. */
export async function openTicket(lead: Lead, o: { reason: "screenshot" | "handoff"; text?: string | null; copyFrom?: { chatId: number; messageId: number } }): Promise<Ticket | null> {
  const chat = adminChat();
  if (!chat) return null;

  let ticket = await getOpenTicket(lead.id);
  const isNew = !ticket;
  if (!ticket) {
    const { data, error } = await db().from("support_tickets").insert({ lead_id: lead.id, reason: o.reason }).select("id, lead_id, status, reason, last_activity_at").single();
    if (error) {
      console.error("[support] openTicket:", error.message, "— supabase/support_and_cleanup.sql çalıştırıldı mı?");
      return null;
    }
    ticket = data as Ticket;
    await recordEvent(lead.id, "SUPPORT_TICKET_OPENED", { ticket: ticket.id, reason: o.reason });
  } else await touch(ticket.id);
  await updateLead(lead.id, { needs_human: true });

  const header =
    `${o.reason === "screenshot" ? "📸 Ekran görüntüsü" : "🙋 İnsan istiyor"} · talep #${ticket.id}${isNew ? "" : " (hâlâ açık)"}\n` +
    `${who(lead)} · id ${lead.telegram_user_id} · ${lead.vip_active ? "VIP MÜŞTERİ" : lead.paid ? "daha önce ödemiş" : `müşteri değil, aşama ${lead.stage}`}` +
    (o.text ? `\n\n“${truncate(o.text, 500)}”` : "") +
    `\n\nBu kişi için yapay zekâ duraklatıldı. Cevaplamak için “Cevapla”ya dokun.`;

  try {
    if (o.copyFrom) {
      // copyMessage (forward değil): müşteri iletmeyi kapatmış olsa da çalışır ve düğme eklenebilir.
      const sent = await tg<{ message_id: number }>("copyMessage", { chat_id: chat, from_chat_id: o.copyFrom.chatId, message_id: o.copyFrom.messageId, caption: truncate(header, 1000), reply_markup: buttons(ticket.id) });
      await remember(sent.message_id, ticket.id, "reply");
    } else await toAdmin(ticket.id, header, "reply", buttons(ticket.id));
  } catch (error) {
    console.error("[support] could not reach the admin chat:", error);
    await toAdmin(ticket.id, header + "\n\n(Görsel kopyalanamadı.)", "reply", buttons(ticket.id));
  }
  return ticket;
}

async function release(ticket: Ticket, status: "solved" | "expired"): Promise<void> {
  await db().from("support_tickets").update({ status, solved_at: new Date().toISOString() }).eq("id", ticket.id);
  await updateLead(ticket.lead_id, { needs_human: false });
  await recordMessage(ticket.lead_id, "event", status === "solved" ? "İnsan ekip konuyu çözdü. Sanal asistan normal şekilde cevaplamaya devam ediyor." : "İnsan ekip zamanında cevap veremedi. Sanal asistan yeniden cevaplıyor; sorun sürüyorsa destek iletişimini sun.");
  await recordEvent(ticket.lead_id, status === "solved" ? "SUPPORT_TICKET_SOLVED" : "SUPPORT_TICKET_EXPIRED", { ticket: ticket.id });
}

/**
 * `needs_human` açıkken müşterinin yazdığı her METİN için çağrılır.
 * true  → metin sahibe gitti, yapay zekâ susmalı.
 * false → açık talep yok (ya da az önce süresi doldu) → yapay zekâ normal cevaplar.
 */
export async function routeToOpenTicket(lead: Lead, text: string, telegramMessageId: number): Promise<boolean> {
  const ticket = await getOpenTicket(lead.id);
  if (!ticket) return false;
  if (hoursSince(ticket.last_activity_at) >= SUPPORT.autoReleaseHours) {
    await release(ticket, "expired");
    await toAdmin(ticket.id, `⏰ Talep #${ticket.id} (${who(lead)}) ${SUPPORT.autoReleaseHours} saattir hareketsizdi — yapay zekâ yeniden cevaplıyor. Herhangi bir talep mesajına yanıt yazarsan yeniden açılır.`, "reply");
    return false;
  }
  if (!(await recordMessage(lead.id, "user", text.slice(0, 2000), telegramMessageId))) return true; // Telegram tekrar denemesi
  await updateLead(lead.id, { user_turns: lead.user_turns + 1, last_user_message_at: new Date().toISOString(), followups_since_reply: 0, blocked: false });
  await touch(ticket.id);
  await toAdmin(ticket.id, `💬 ${who(lead)} · talep #${ticket.id}\n\n“${truncate(text, 1500)}”\n\nÇözüldü mü? ✅'ye dokun, yapay zekâ devam etsin. Değilse “Cevapla”.`, "reply", buttons(ticket.id));
  // Kişiyi sessizlikte bırakma — ama saatte en fazla bir "aldım" mesajı.
  if (lead.chat_id && hoursSince(lead.last_bot_message_at) >= 1) {
    await sendText(lead.chat_id, tx("ticketAck")).then(
      () => updateLead(lead.id, { last_bot_message_at: new Date().toISOString() }),
      () => undefined,
    );
  }
  return true;
}

/** Müşteri fotoğraf / görsel dosya gönderdi. Bot görsel göremez; bir insan bakar. */
export async function handleCustomerImage(lead: Lead, m: { chat: { id: number }; message_id: number; caption?: string }): Promise<void> {
  if (!(await recordMessage(lead.id, "user", `[kişi bir görsel gönderdi]${m.caption ? ` ${m.caption.slice(0, 1000)}` : ""}`, m.message_id))) return;
  await updateLead(lead.id, { last_user_message_at: new Date().toISOString(), followups_since_reply: 0 });
  const ticket = await openTicket(lead, { reason: "screenshot", text: m.caption, copyFrom: { chatId: m.chat.id, messageId: m.message_id } });
  const support = supportContact();
  const reply = ticket ? tx("imageReceived") : `${tx("imageNoTeam")}${support ? ` ${tx("handoffContact", { support: support.label })}` : ""}`;
  if (lead.chat_id) {
    await sendText(lead.chat_id, reply);
    await recordMessage(lead.id, "assistant", reply);
    await updateLead(lead.id, { last_bot_message_at: new Date().toISOString() });
  }
}

/* ------------------------------------------------------------------ */
/*  Sahip tarafı                                                       */
/* ------------------------------------------------------------------ */

async function ticketWithLead(id: number): Promise<{ ticket: Ticket; lead: Lead } | null> {
  const { data } = await db().from("support_tickets").select("id, lead_id, status, reason, last_activity_at").eq("id", id).maybeSingle();
  const lead = data ? await getLeadById((data as Ticket).lead_id) : null;
  return data && lead ? { ticket: data as Ticket, lead } : null;
}

const forceReply = (placeholder: string) => ({ force_reply: true, input_field_placeholder: placeholder });
const TEACH_HELP = "Kendi cümlelerinle yaz:\n1) sorun neydi\n2) nasıl çözülüyor\n\nBunu bir bilgi kaydına çeviririm; bot bir dahaki sefere bu durumu tek başına halleder. Kayıtları /admin → Satış Asistanı bölümünden düzenleyebilir ya da silebilirsin.";

export async function handleAdminCallback(q: { id: string; data?: string }): Promise<void> {
  const match = q.data?.match(/^tk:(reply|done|teach):(\d+)$/);
  const found = match ? await ticketWithLead(Number(match[2])) : null;
  if (!match || !found) return answerCallback(q.id, "Talep bulunamadı.");
  const { ticket, lead } = found;
  await answerCallback(q.id);

  if (match[1] === "reply") {
    await toAdmin(ticket.id, `✍️ Talep #${ticket.id} — ${who(lead)} için cevabını yaz.\nYazdığın metin müşteriye AYNEN gider; gönderileni sana da gösteririm.`, "reply", forceReply("Müşteriye cevabın…"));
  } else if (match[1] === "teach") {
    await toAdmin(ticket.id, `🧠 Yapay zekâya öğret — talep #${ticket.id}\n${TEACH_HELP}`, "teach", forceReply("Sorun: … Çözüm: …"));
  } else {
    if (ticket.status === "open") await release(ticket, "solved");
    await toAdmin(ticket.id, `✅ Talep #${ticket.id} çözüldü — yapay zekâ ${who(lead)} ile yeniden konuşuyor.\n\n🧠 İsteğe bağlı ama değerli: BU mesaja yanıt olarak sorunu ve çözümü yaz.\n${TEACH_HELP}`, "teach");
  }
}

async function teach(ticket: Ticket, lead: Lead, note: string): Promise<void> {
  const history = await getRecentMessages(lead.id, 10);
  const context = history.map((m) => `${m.role === "user" ? "MÜŞTERİ" : m.role === "assistant" ? "EKİP/BOT" : "SİSTEM"}: ${m.content}`).join("\n");
  const { json } = await deepseekJson({
    messages: [
      {
        role: "system",
        content: PROMPT_TEXTS.teach,
      },
      { role: "user", content: `OWNER NOTE:\n${note.slice(0, 2000)}\n\nCONVERSATION (context only):\n${context.slice(-3000)}` },
    ],
    temperature: 0.2, maxTokens: 700, thinking: false, timeoutMs: 30_000, retries: 1, label: "support-teach",
  });
  const entry = json as { issue?: unknown; solution?: unknown } | null;
  const issue = typeof entry?.issue === "string" ? entry.issue.trim() : "";
  const solution = typeof entry?.solution === "string" ? entry.solution.trim() : "";
  if (!issue || !solution) {
    await toAdmin(ticket.id, "🧠 Notunda hem SORUN hem ÇÖZÜM bulamadım. Bu mesaja tekrar yanıt yaz, örneğin:\n“Sorun: ödeme yaptı ama VIP linki gelmedi. Çözüm: 2 dakika bekleyip /start yazmasını söyle; gelmezse Whop makbuzunu istesin.”", "teach");
    return;
  }
  try {
    await addKnowledge({ issue, solution, ticket_id: ticket.id });
  } catch (error) {
    await toAdmin(ticket.id, `🧠 Kaydedilmedi: ${error instanceof SettingsError ? error.problems.join(" ") : (error as Error).message}\nTekrar denemek için bu mesaja yanıt yaz.`, "teach");
    return;
  }
  await recordEvent(lead.id, "SUPPORT_KNOWLEDGE_ADDED", { ticket: ticket.id });
  await toAdmin(ticket.id, `🧠 Kaydedildi. Bot artık şunu biliyor:\n\nSORUN: ${issue}\nÇÖZÜM: ${solution}\n\n/admin → Satış Asistanı bölümünden düzenleyebilir ya da silebilirsin.${ticket.status === "open" ? "\n\nBu talep çözüldü mü?" : ""}`, "reply", ticket.status === "open" ? buttons(ticket.id) : undefined);
}

/** Sahip bir talep mesajına Telegram "yanıtla" ile yazdı. Mesaj bir taleple ilgili değilse false döner. */
export async function handleAdminReply(m: { text?: string; reply_to_message?: { message_id: number } }): Promise<boolean> {
  if (!m.reply_to_message) return false;
  const { data } = await db().from("support_admin_messages").select("ticket_id, mode").eq("message_id", m.reply_to_message.message_id).maybeSingle();
  if (!data) return false;
  const found = await ticketWithLead(data.ticket_id as number);
  if (!found) return false;
  const { ticket, lead } = found;
  const text = m.text?.trim();
  if (!text) {
    await toAdmin(ticket.id, "Yalnızca METİN iletebilirim. Cevabını yazı olarak gönder.", data.mode as Mode);
    return true;
  }
  if (data.mode === "teach") {
    await teach(ticket, lead, text);
    return true;
  }

  if (!lead.chat_id) {
    await toAdmin(ticket.id, "Bu kişinin botla bir Telegram sohbeti yok.", "reply");
    return true;
  }
  const final = text.startsWith("!") ? text.slice(1).trim() : text;
  try {
    await sendText(lead.chat_id, final);
  } catch (error) {
    const blocked = error instanceof TelegramError && error.isBlocked;
    if (blocked) await updateLead(lead.id, { blocked: true });
    await toAdmin(ticket.id, blocked ? `❌ ${who(lead)} botu engellemiş — mesaj iletilemiyor.` : `❌ İletilemedi: ${(error as Error).message}`, "reply");
    return true;
  }
  await recordMessage(lead.id, "assistant", final);
  // Kapanmış bir talebe cevap yazmak onu yeniden açar; müşterinin sonraki mesajı yine buraya düşer.
  if (ticket.status !== "open") await db().from("support_tickets").update({ status: "open", solved_at: null }).eq("id", ticket.id);
  await touch(ticket.id);
  await updateLead(lead.id, { needs_human: true, last_bot_message_at: new Date().toISOString() });
  await recordEvent(lead.id, "SUPPORT_REPLY_SENT", { ticket: ticket.id });
  await toAdmin(ticket.id, `📤 ${who(lead)} kişisine gönderildi:\n\n“${truncate(final, 1500)}”\n\nCevabı buraya düşecek. Sorun çözülünce ✅ Çözüldü'ye dokun, yapay zekâ devam etsin.`, "reply", buttons(ticket.id));
  return true;
}

/* ------------------------------------------------------------------ */
/*  Yönetim paneli                                                     */
/* ------------------------------------------------------------------ */

export async function closeTicketFromPanel(id: number): Promise<boolean> {
  const found = await ticketWithLead(id);
  if (!found) return false;
  if (found.ticket.status === "open") await release(found.ticket, "solved");
  return true;
}

/** Talebi ve (mümkün olduğunca) sahibin Telegram sohbetindeki ilgili mesajları — kopyalanan ekran görüntüsü dahil — siler. */
export async function deleteTicket(id: number): Promise<void> {
  const chat = adminChat();
  const { data } = await db().from("support_admin_messages").select("message_id").eq("ticket_id", id);
  for (const row of data ?? []) {
    if (chat) await tg("deleteMessage", { chat_id: chat, message_id: row.message_id }).catch(() => undefined); // Telegram buna ~48 saat izin verir
  }
  const found = await ticketWithLead(id);
  if (found?.ticket.status === "open") await release(found.ticket, "solved");
  await db().from("support_tickets").delete().eq("id", id);
}
