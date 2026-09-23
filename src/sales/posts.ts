import { BUSINESS, getPlan, supportContact, type PlanKey } from "../config/business";
import { getEnv } from "../lib/env";
import { INTEGRATION_OVERRIDES } from "../lib/integrations";
import { recordEvent, type Lead } from "../lib/leads";
import { db } from "../lib/supabase";
import { applyDivider, sanitizeTelegramHtml, visibleLength } from "../lib/tghtml";
import { tg, type InlineKeyboard } from "../lib/telegram";
import { randomToken } from "../lib/util";
import { findForbiddenClaims } from "./guardrails";

/**
 * KANAL PAYLAŞIMLARI — panelden ücretsiz / VIP kanala post yazma, zamanlama, şablon ve satış takibi.
 *
 *  Panel → taslak / zamanla / hemen gönder      (channel_posts)
 *  Her dakika (Supabase pg_cron → /api/cron/posts): sırası gelenler gönderilir,
 *  gönderimden 1 saat sonra metin + görsel silinir; başlık, etiket, mesaj kimliği ve SAYILAR kalır.
 *
 *  Post bazlı satış takibi: paylaşımdaki düğmeler botu  t.me/bot?start=p<postId>_<eylem>  ile açar.
 *  Bot kişiyi tanır, tıklamayı kaydeder (post_clicks) ve istenen planı hemen sunar. Ödeme geldiğinde
 *  son 7 gündeki son tıklamaya bağlanır (payments.post_id) → "hangi post kaç satış getirdi" görülür.
 *  Kişi bota ilk kez bir paylaşımdan geldiyse leads.origin = 'channel_post' olur → "bot mu sattı, kanal mı" ayrımı.
 */

export type ButtonStyle = "primary" | "success" | "danger";
export type PostButton = { text: string; type: "plan" | "planlar" | "bot" | "free_channel" | "support" | "url"; value?: string; style?: ButtonStyle | null };
export type PostOptions = {
  silent?: boolean; protect?: boolean; pin?: boolean; noPreview?: boolean;
  /** Bağlantı önizlemesi metnin üstünde / büyük görselle */
  previewAbove?: boolean; previewLarge?: boolean;
  /** Görsel bulanık gelir, dokununca açılır */
  mediaSpoiler?: boolean;
  /** Açıklama görselin üstünde */
  captionAbove?: boolean;
  /** Paragraflar arasına otomatik konan çizgi ("" = yok) */
  divider?: string;
};
export type PostPoll = { question: string; options: string[]; multiple: boolean; quiz: boolean; correctIndex: number; explanation: string; closeAfterMinutes: number };
export type PostInput = {
  id?: number; channel: "free" | "vip"; kind: "message" | "poll"; title: string; tags: string[]; text: string; mediaType: "photo" | "video" | null; mediaPath: string | null;
  buttons: PostButton[][]; options: PostOptions; poll: PostPoll | null; scheduledAt: string | null; templateId?: number | null;
};
export type PostRow = {
  id: number; created_at: string; updated_at: string; channel: "free" | "vip"; title: string; tags: string[]; text: string | null; media_type: "photo" | "video" | null; media_path: string | null;
  buttons: PostButton[][]; options: PostOptions; kind: "message" | "poll"; poll: PostPoll | null; status: "draft" | "scheduled" | "sending" | "sent" | "failed"; scheduled_at: string | null; sent_at: string | null;
  telegram_chat_id: string | null; telegram_message_id: number | null; error: string | null; content_purged: boolean; template_id: number | null;
  starts: number; checkouts: number; purchases: number; revenue: number;
};

const CAPTION_MAX = 1024;
const TEXT_MAX = 4096;
const ATTRIBUTION_DAYS = 7;
const PURGE_AFTER_MS = 60 * 60 * 1000;
const BUCKET = "post-media";

export class PostError extends Error {}

/* ------------------------------------------------------------------ */
/*  Doğrulama                                                          */
/* ------------------------------------------------------------------ */

const PLAN_KEYS = new Set(BUSINESS.plans.map((p) => p.key));

export function validatePost(raw: Partial<PostInput>, { allowClaims = false } = {}): PostInput {
  const problems: string[] = [];
  const channel = raw.channel === "vip" ? "vip" : "free";
  const kind = raw.kind === "poll" ? "poll" : "message";
  const title = String(raw.title ?? "").trim().slice(0, 120);
  const tags = [...new Set((Array.isArray(raw.tags) ? raw.tags : []).map((t) => String(t).trim().toLowerCase().replace(/^#/, "").slice(0, 30)).filter(Boolean))].slice(0, 12);
  const text = sanitizeTelegramHtml(String(raw.text ?? "")).trim();
  const mediaType = kind === "message" && (raw.mediaType === "photo" || raw.mediaType === "video") ? raw.mediaType : null;
  const mediaPath = mediaType && typeof raw.mediaPath === "string" && /^[a-z0-9_./-]{5,120}$/i.test(raw.mediaPath) ? raw.mediaPath : null;
  if (mediaType && !mediaPath) problems.push("Görsel yüklenmemiş.");
  if (kind === "message" && !text && !mediaPath) problems.push("Metin ya da görsel gerekli.");
  const max = mediaPath ? CAPTION_MAX : TEXT_MAX;
  if (kind === "message" && visibleLength(text) > max) problems.push(`Metin en fazla ${max} karakter olabilir (görselli paylaşımda ${CAPTION_MAX}).`);
  let poll: PostPoll | null = null;
  if (kind === "poll") {
    const q = raw.poll ?? ({} as Partial<PostPoll>);
    const question = String(q.question ?? "").trim().slice(0, 300);
    const options = (Array.isArray(q.options) ? q.options : []).map((o) => String(o).trim().slice(0, 100)).filter(Boolean).slice(0, 10);
    if (!question) problems.push("Anket sorusu boş olamaz (en fazla 300 karakter).");
    if (options.length < 2) problems.push("Anket için en az 2 seçenek gerekli (en fazla 10, her biri 100 karakter).");
    if (new Set(options).size !== options.length) problems.push("Anket seçenekleri birbirinden farklı olmalı.");
    const quiz = Boolean(q.quiz);
    const correctIndex = quiz ? Number(q.correctIndex) : 0;
    if (quiz && !(Number.isInteger(correctIndex) && correctIndex >= 0 && correctIndex < options.length)) problems.push("Bilgi yarışması için doğru seçeneği işaretleyin.");
    const explanation = quiz ? String(q.explanation ?? "").trim().slice(0, 200) : "";
    const closeAfterMinutes = Math.max(0, Math.min(10, Math.floor(Number(q.closeAfterMinutes) || 0))); // Telegram: 5–600 saniye
    poll = { question, options, multiple: !quiz && Boolean(q.multiple), quiz, correctIndex, explanation, closeAfterMinutes };
  }
  const buttons: PostButton[][] = [];
  for (const row of Array.isArray(raw.buttons) ? raw.buttons.slice(0, 8) : []) {
    const cleanRow: PostButton[] = [];
    for (const b of Array.isArray(row) ? row.slice(0, 3) : []) {
      const type = (["plan", "planlar", "bot", "free_channel", "support", "url"] as const).find((t) => t === b?.type);
      const label = String(b?.text ?? "").trim().slice(0, 40);
      if (!type || !label) continue;
      const value = String(b?.value ?? "").trim();
      if (type === "plan" && !PLAN_KEYS.has(value as PlanKey)) { problems.push(`“${label}” düğmesi için plan seçilmemiş.`); continue; }
      if (type === "url" && !/^https?:\/\/[^\s<>"]+$/i.test(value)) { problems.push(`“${label}” düğmesinin adresi https:// ile başlamalı.`); continue; }
      if (type === "support" && !supportContact()) { problems.push("Destek düğmesi için SUPPORT_USERNAME tanımlı olmalı."); continue; }
      const style = b?.style === "primary" || b?.style === "success" || b?.style === "danger" ? b.style : null;
      cleanRow.push({ text: label, type, value: type === "plan" || type === "url" ? value : undefined, style });
    }
    if (cleanRow.length) buttons.push(cleanRow);
  }
  const o = (raw.options ?? {}) as PostOptions;
  const DIVIDERS = ["━━━━━━━━━━━━", "──────────────", "═══════════════", "- - - - - - - - - -", "· · · · · · · · · ·", "▬▬▬▬▬▬▬▬▬▬", "⸻"];
  const divider = typeof o.divider === "string" && DIVIDERS.includes(o.divider.trim()) ? o.divider.trim() : "";
  const options: PostOptions = { silent: Boolean(o.silent), protect: Boolean(o.protect), pin: Boolean(o.pin), noPreview: o.noPreview !== false, previewAbove: Boolean(o.previewAbove), previewLarge: Boolean(o.previewLarge), mediaSpoiler: Boolean(o.mediaSpoiler), captionAbove: Boolean(o.captionAbove), divider };
  let scheduledAt: string | null = null;
  if (raw.scheduledAt) {
    const d = new Date(raw.scheduledAt);
    if (Number.isNaN(d.getTime())) problems.push("Zamanlama tarihi geçersiz.");
    else if (d.getTime() < Date.now() - 60_000) problems.push("Zamanlama tarihi geçmişte kalmış.");
    else scheduledAt = d.toISOString();
  }
  if (!allowClaims) {
    const claims = findForbiddenClaims(`${text.replace(/<[^>]+>/g, " ")} ${poll ? `${poll.question} ${poll.options.join(" ")} ${poll.explanation}` : ""}`).filter((c) => c !== "raw_link" && c !== "invented_promotion");
    if (claims.length) problems.push(`Metin yasak bir vaat içeriyor (${claims.join(", ")}): “banko”, “garanti”, “kesin kazanç”, “risksiz”, “son yerler”, “kaybettiğini geri al”, bahis sitesi önerme gibi ifadeler hem yanıltıcı reklamdır hem Meta reklam hesabınızı riske atar. Yine de göndermek için “Uyarıya rağmen gönder” kutusunu işaretleyin.`);
  }
  if (problems.length) throw new PostError(problems.join("\n"));
  return { id: raw.id, channel, kind, title: title || (poll?.question ?? text.replace(/<[^>]+>/g, "").split("\n")[0] ?? "").slice(0, 60) || "Paylaşım", tags, text: kind === "poll" ? "" : text, mediaType, mediaPath, buttons, options, poll, scheduledAt, templateId: raw.templateId ?? null };
}

/* ------------------------------------------------------------------ */
/*  Gönderim                                                           */
/* ------------------------------------------------------------------ */

function channelChatId(channel: "free" | "vip"): string {
  const env = getEnv();
  const id = channel === "free" ? env.TELEGRAM_FREE_CHANNEL_ID : env.TELEGRAM_VIP_CHANNEL_ID;
  if (!id) throw new PostError(channel === "free" ? "TELEGRAM_FREE_CHANNEL_ID tanımlı değil." : "TELEGRAM_VIP_CHANNEL_ID tanımlı değil.");
  return id;
}

export function mediaUrl(path: string): string {
  return `${getEnv().SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

/** Paylaşımdaki düğme → botu açan derin bağlantı (post kimliği ve eylem taşır). */
export function buildKeyboard(postId: number, buttons: PostButton[][]): InlineKeyboard | undefined {
  const env = getEnv();
  const bot = `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=`;
  const rows = buttons.map((row) =>
    row.map((b) => {
      const url =
        b.type === "plan" ? `${bot}p${postId}_${b.value}` :
        b.type === "planlar" ? `${bot}p${postId}_planlar` :
        b.type === "bot" ? `${bot}p${postId}` :
        b.type === "free_channel" ? INTEGRATION_OVERRIDES.freeChannelUrl || env.TELEGRAM_FREE_CHANNEL_URL :
        b.type === "support" ? supportContact()?.url ?? `${bot}p${postId}` :
        String(b.value);
      return { text: b.text, url, ...(b.style ? { style: b.style } : {}) };
    }),
  ).filter((r) => r.length);
  return rows.length ? { inline_keyboard: rows } : undefined;
}

export async function sendPost(id: number): Promise<PostRow> {
  const { data } = await db().from("channel_posts").select("*").eq("id", id).maybeSingle();
  const post = data as PostRow | null;
  if (!post) throw new PostError("Paylaşım bulunamadı.");
  if (post.content_purged && post.kind !== "poll") throw new PostError("Bu paylaşımın metni silinmiş (gönderimden 1 saat sonra silinir); kopyalayıp yeniden oluşturun.");
  if (post.status === "sent") throw new PostError("Bu paylaşım zaten gönderildi. Tekrar göndermek için kopyalayın.");
  const chatId = channelChatId(post.channel);
  const keyboard = buildKeyboard(post.id, post.buttons ?? []);
  const o = post.options ?? {};
  const text = applyDivider(post.text ?? "", o.divider);
  const common = { chat_id: chatId, parse_mode: "HTML", disable_notification: Boolean(o.silent), protect_content: Boolean(o.protect), ...(keyboard ? { reply_markup: keyboard } : {}) };
  try {
    let sent: { message_id: number };
    if (post.kind === "poll" && post.poll) {
      const pl = post.poll;
      sent = await tg<{ message_id: number }>("sendPoll", {
        ...common, question: pl.question, options: pl.options.map((t) => ({ text: t })), is_anonymous: true,
        type: pl.quiz ? "quiz" : "regular", allows_multiple_answers: !pl.quiz && pl.multiple,
        ...(pl.quiz ? { correct_option_id: pl.correctIndex, ...(pl.explanation ? { explanation: pl.explanation } : {}) } : {}),
        ...(pl.closeAfterMinutes ? { open_period: Math.min(600, pl.closeAfterMinutes * 60) } : {}),
      });
    } else if (post.media_type && post.media_path) {
      const method = post.media_type === "photo" ? "sendPhoto" : "sendVideo";
      sent = await tg<{ message_id: number }>(method, { ...common, [post.media_type]: mediaUrl(post.media_path), ...(text ? { caption: text } : {}), has_spoiler: Boolean(o.mediaSpoiler), show_caption_above_media: Boolean(o.captionAbove) });
    } else {
      sent = await tg<{ message_id: number }>("sendMessage", { ...common, text, link_preview_options: { is_disabled: o.noPreview !== false, show_above_text: Boolean(o.previewAbove), prefer_large_media: Boolean(o.previewLarge) } });
    }
    if (post.options?.pin) await tg("pinChatMessage", { chat_id: chatId, message_id: sent.message_id, disable_notification: true }).catch(() => undefined);
    const { data: updated } = await db().from("channel_posts").update({ status: "sent", sent_at: new Date().toISOString(), telegram_chat_id: String(chatId), telegram_message_id: sent.message_id, error: null, updated_at: new Date().toISOString() }).eq("id", id).select("*").single();
    await recordEvent(null, "POST_SENT", { post: id, channel: post.channel });
    return updated as PostRow;
  } catch (error) {
    const message = (error as Error).message.slice(0, 500);
    await db().from("channel_posts").update({ status: "failed", error: message, updated_at: new Date().toISOString() }).eq("id", id);
    throw new PostError(`Telegram gönderimi başarısız: ${message}`);
  }
}

/** Sırası gelen zamanlanmış paylaşımları gönderir, eski içerikleri siler. Her dakika (pg_cron) ve panelden çağrılır. */
export async function runDuePosts(): Promise<{ sent: number; failed: number; purged: number }> {
  const now = new Date().toISOString();
  const { data } = await db().from("channel_posts").select("id").eq("status", "scheduled").lte("scheduled_at", now).order("scheduled_at", { ascending: true }).limit(20);
  let sent = 0, failed = 0;
  for (const row of (data ?? []) as { id: number }[]) {
    // Aynı postu iki çalıştırma birden göndermesin: yalnızca 'scheduled' → 'sending' geçişini yapan gönderir.
    const { data: locked } = await db().from("channel_posts").update({ status: "sending" }).eq("id", row.id).eq("status", "scheduled").select("id");
    if (!locked?.length) continue;
    try { await sendPost(row.id); sent++; } catch (error) { failed++; console.error("[posts] send", row.id, error); }
  }
  const purged = await purgeSentContent();
  return { sent, failed, purged };
}

/** Gönderimden 1 saat sonra metin ve görsel silinir; sayılar ve mesaj kimliği kalır. */
export async function purgeSentContent(): Promise<number> {
  const cutoff = new Date(Date.now() - PURGE_AFTER_MS).toISOString();
  const { data } = await db().from("channel_posts").select("id, media_path").eq("status", "sent").eq("content_purged", false).lte("sent_at", cutoff).limit(100);
  const rows = (data ?? []) as { id: number; media_path: string | null }[];
  if (!rows.length) return 0;
  const paths = rows.map((r) => r.media_path).filter((p): p is string => Boolean(p));
  if (paths.length) {
    // Aynı görsel bir şablonda da kullanılıyorsa dosya kalır.
    const { data: used } = await db().from("post_templates").select("media_path").in("media_path", paths);
    const keep = new Set((used ?? []).map((u) => u.media_path as string));
    const remove = paths.filter((p) => !keep.has(p));
    if (remove.length) await db().storage.from(BUCKET).remove(remove).catch(() => undefined);
  }
  await db().from("channel_posts").update({ text: null, media_path: null, buttons: [], content_purged: true, updated_at: new Date().toISOString() }).in("id", rows.map((r) => r.id));
  return rows.length;
}

export async function deleteFromChannel(id: number): Promise<void> {
  const { data } = await db().from("channel_posts").select("telegram_chat_id, telegram_message_id").eq("id", id).maybeSingle();
  if (!data?.telegram_chat_id || !data.telegram_message_id) throw new PostError("Bu paylaşımın kanalda bir mesajı yok.");
  await tg("deleteMessage", { chat_id: data.telegram_chat_id, message_id: data.telegram_message_id });
  await db().from("channel_posts").update({ status: "failed", error: "Kanaldan silindi", telegram_message_id: null, updated_at: new Date().toISOString() }).eq("id", id);
}

/** Anketi kapatır (sonuçlar kanalda kalır). */
export async function stopPoll(id: number): Promise<void> {
  const { data } = await db().from("channel_posts").select("telegram_chat_id, telegram_message_id, kind").eq("id", id).maybeSingle();
  if (!data?.telegram_chat_id || !data.telegram_message_id) throw new PostError("Bu paylaşımın kanalda bir mesajı yok.");
  if (data.kind !== "poll") throw new PostError("Bu paylaşım bir anket değil.");
  await tg("stopPoll", { chat_id: data.telegram_chat_id, message_id: data.telegram_message_id });
}

export async function pinInChannel(id: number, pin: boolean): Promise<void> {
  const { data } = await db().from("channel_posts").select("telegram_chat_id, telegram_message_id").eq("id", id).maybeSingle();
  if (!data?.telegram_chat_id || !data.telegram_message_id) throw new PostError("Bu paylaşımın kanalda bir mesajı yok.");
  await tg(pin ? "pinChatMessage" : "unpinChatMessage", { chat_id: data.telegram_chat_id, message_id: data.telegram_message_id, ...(pin ? { disable_notification: true } : {}) });
}

/** Gönderilmiş ama henüz silinmemiş (1 saat içinde) bir paylaşımın metnini / düğmelerini kanalda günceller. */
export async function editInChannel(id: number, input: PostInput): Promise<void> {
  const { data } = await db().from("channel_posts").select("*").eq("id", id).maybeSingle();
  const post = data as PostRow | null;
  if (!post?.telegram_chat_id || !post.telegram_message_id) throw new PostError("Bu paylaşımın kanalda bir mesajı yok.");
  if (post.content_purged) throw new PostError("Metin silinmiş; artık düzenlenemez, yalnızca kanaldan silinebilir.");
  const keyboard = buildKeyboard(id, input.buttons);
  const base = { chat_id: post.telegram_chat_id, message_id: post.telegram_message_id, parse_mode: "HTML", ...(keyboard ? { reply_markup: keyboard } : { reply_markup: { inline_keyboard: [] } }) };
  const text = applyDivider(input.text, input.options.divider);
  if (post.kind === "poll") await tg("editMessageReplyMarkup", { chat_id: post.telegram_chat_id, message_id: post.telegram_message_id, reply_markup: keyboard ?? { inline_keyboard: [] } });
  else if (post.media_type) await tg("editMessageCaption", { ...base, caption: text, show_caption_above_media: Boolean(input.options.captionAbove) });
  else await tg("editMessageText", { ...base, text, link_preview_options: { is_disabled: input.options.noPreview !== false, show_above_text: Boolean(input.options.previewAbove), prefer_large_media: Boolean(input.options.previewLarge) } });
  await db().from("channel_posts").update({ title: input.title, tags: input.tags, text: input.text, buttons: input.buttons, options: { ...post.options, ...input.options }, updated_at: new Date().toISOString() }).eq("id", id);
}

/* ------------------------------------------------------------------ */
/*  Kaydetme / şablon / görsel                                         */
/* ------------------------------------------------------------------ */

export async function savePost(input: PostInput, mode: "draft" | "schedule" | "send"): Promise<PostRow> {
  const status = mode === "schedule" ? "scheduled" : "draft";
  if (mode === "schedule" && !input.scheduledAt) throw new PostError("Zamanlamak için tarih ve saat seçin.");
  const values = {
    channel: input.channel, kind: input.kind, poll: input.poll, title: input.title, tags: input.tags, text: input.text, media_type: input.mediaType, media_path: input.mediaPath, buttons: input.buttons, options: input.options,
    status, scheduled_at: mode === "schedule" ? input.scheduledAt : null, template_id: input.templateId ?? null, error: null, content_purged: false, updated_at: new Date().toISOString(),
  };
  let row: PostRow;
  if (input.id) {
    const { data: existing } = await db().from("channel_posts").select("status").eq("id", input.id).maybeSingle();
    if (!existing) throw new PostError("Paylaşım bulunamadı.");
    if (existing.status === "sent" || existing.status === "sending") throw new PostError("Gönderilmiş paylaşım yeniden kaydedilemez; “Kopyala” ile yeni bir paylaşım oluşturun.");
    const { data, error } = await db().from("channel_posts").update(values).eq("id", input.id).select("*").single();
    if (error) throw new PostError(error.message);
    row = data as PostRow;
  } else {
    const { data, error } = await db().from("channel_posts").insert(values).select("*").single();
    if (error) throw new PostError(`${error.message} — Supabase'de supabase/posts.sql çalıştırıldı mı?`);
    row = data as PostRow;
  }
  if (input.templateId && !input.id) await markTemplateUsed(input.templateId).catch(() => undefined);
  if (mode === "send") row = await sendPost(row.id);
  return row;
}

export async function duplicatePost(id: number): Promise<PostRow> {
  const { data } = await db().from("channel_posts").select("*").eq("id", id).maybeSingle();
  const post = data as PostRow | null;
  if (!post) throw new PostError("Paylaşım bulunamadı.");
  if (post.content_purged) throw new PostError("Metni silinmiş paylaşım kopyalanamaz; şablonlardan yenisini oluşturun.");
  const { data: copy, error } = await db().from("channel_posts").insert({ channel: post.channel, kind: post.kind, poll: post.poll, title: `${post.title} (kopya)`.slice(0, 120), tags: post.tags, text: post.text, media_type: post.media_type, media_path: post.media_path, buttons: post.buttons, options: post.options, status: "draft", template_id: post.template_id }).select("*").single();
  if (error) throw new PostError(error.message);
  return copy as PostRow;
}

export async function deletePostRow(id: number): Promise<void> {
  const { data } = await db().from("channel_posts").select("media_path, status").eq("id", id).maybeSingle();
  if (data?.media_path && data.status !== "sent") {
    const { data: used } = await db().from("post_templates").select("id").eq("media_path", data.media_path).limit(1);
    if (!used?.length) await db().storage.from(BUCKET).remove([data.media_path]).catch(() => undefined);
  }
  await db().from("channel_posts").delete().eq("id", id);
}

export async function saveTemplate(input: PostInput & { templateId?: number | null }): Promise<void> {
  const values = { channel: input.channel, kind: input.kind, poll: input.poll, title: input.title, tags: input.tags, text: input.text, media_type: input.mediaType, media_path: input.mediaPath, buttons: input.buttons, options: input.options, updated_at: new Date().toISOString() };
  if (!values.text && !values.media_path && !values.poll) throw new PostError("Şablon boş olamaz.");
  const { error } = input.templateId ? await db().from("post_templates").update(values).eq("id", input.templateId) : await db().from("post_templates").insert(values);
  if (error) throw new PostError(error.message);
}

export async function deleteTemplate(id: number): Promise<void> {
  const { data } = await db().from("post_templates").select("media_path").eq("id", id).maybeSingle();
  await db().from("post_templates").delete().eq("id", id);
  if (data?.media_path) {
    const { data: used } = await db().from("channel_posts").select("id").eq("media_path", data.media_path).limit(1);
    if (!used?.length) await db().storage.from(BUCKET).remove([data.media_path]).catch(() => undefined);
  }
}

export async function markTemplateUsed(id: number): Promise<void> {
  const { data } = await db().from("post_templates").select("uses").eq("id", id).maybeSingle();
  if (data) await db().from("post_templates").update({ uses: Number(data.uses ?? 0) + 1 }).eq("id", id);
}

const MEDIA_TYPES: Record<string, { ext: string; kind: "photo" | "video" }> = { "image/jpeg": { ext: "jpg", kind: "photo" }, "image/png": { ext: "png", kind: "photo" }, "image/webp": { ext: "webp", kind: "photo" }, "video/mp4": { ext: "mp4", kind: "video" } };

/** Panelden gelen base64 dosyayı depoya yazar; Telegram'a herkese açık adresi verilir. */
export async function uploadMedia(base64: string, mime: string): Promise<{ path: string; kind: "photo" | "video"; url: string }> {
  const type = MEDIA_TYPES[mime];
  if (!type) throw new PostError("Yalnızca JPG, PNG, WebP ya da MP4 yüklenebilir.");
  const buffer = Buffer.from(base64.replace(/^data:[^;]+;base64,/, ""), "base64");
  if (!buffer.length) throw new PostError("Dosya boş.");
  if (buffer.length > 3_500_000) throw new PostError("Dosya en fazla 3,5 MB olabilir (Vercel sınırı). Daha büyük görseli küçültün; daha büyük videoyu Telegram'dan elle gönderin.");
  const path = `${new Date().toISOString().slice(0, 10)}/${randomToken(12)}.${type.ext}`;
  const { error } = await db().storage.from(BUCKET).upload(path, buffer, { contentType: mime, upsert: false });
  if (error) throw new PostError(`${error.message} — Supabase'de supabase/posts.sql çalıştırıldı mı? (post-media alanı gerekli)`);
  return { path, kind: type.kind, url: mediaUrl(path) };
}

/* ------------------------------------------------------------------ */
/*  Satış takibi: post düğmesi → bot → ödeme                          */
/* ------------------------------------------------------------------ */

export type PostRef = { id: number; action: string | null };

/** /start yükü: p<postId> | p<postId>_<planKey|planlar|kanal> */
export function parsePostRef(payload: string | null | undefined): PostRef | null {
  const m = payload?.match(/^p(\d{1,12})(?:_([a-z_]{1,24}))?$/i);
  return m ? { id: Number(m[1]), action: m[2]?.toLowerCase() ?? null } : null;
}

export async function recordPostStart(post: PostRef, lead: Lead): Promise<void> {
  const { error } = await db().from("post_clicks").insert({ post_id: post.id, lead_id: lead.id, action: post.action });
  if (error) return; // post silinmiş olabilir
  await db().rpc("post_bump", { p_id: post.id, p_starts: 1 });
  await recordEvent(lead.id, "POST_BUTTON_START", { post: post.id, action: post.action });
}

async function lastPostClick(leadId: string): Promise<number | null> {
  const { data } = await db().from("post_clicks").select("post_id").eq("lead_id", leadId).gte("created_at", new Date(Date.now() - ATTRIBUTION_DAYS * 86_400_000).toISOString()).order("created_at", { ascending: false }).limit(1);
  return (data?.[0]?.post_id as number | undefined) ?? null;
}

export async function attributeCheckout(leadId: string): Promise<void> {
  try {
    const postId = await lastPostClick(leadId);
    if (postId) await db().rpc("post_bump", { p_id: postId, p_checkouts: 1 });
  } catch (error) { console.error("[posts] attributeCheckout:", error); }
}

export async function attributePurchase(leadId: string, whopPaymentId: string, amount: number, isFirst: boolean): Promise<void> {
  try {
    const postId = await lastPostClick(leadId);
    if (!postId) return;
    await db().from("payments").update({ post_id: postId }).eq("whop_payment_id", whopPaymentId);
    await db().rpc("post_bump", { p_id: postId, p_purchases: isFirst ? 1 : 0, p_revenue: amount });
  } catch (error) { console.error("[posts] attributePurchase:", error); }
}

/* ------------------------------------------------------------------ */
/*  Panel verisi                                                       */
/* ------------------------------------------------------------------ */

export async function postsOverview() {
  const [posts, templates, buyers, sales] = await Promise.all([
    db().from("channel_posts").select("*").order("created_at", { ascending: false }).limit(300),
    db().from("post_templates").select("*").order("updated_at", { ascending: false }).limit(200),
    db().from("payments").select("post_id, amount, is_first, created_at, leads(first_name, username)").not("post_id", "is", null).neq("status", "refunded").order("created_at", { ascending: false }).limit(2000),
    db().from("payments").select("amount, is_first, post_id, lead_id, leads(origin, source, landing_url)").neq("status", "refunded").eq("is_first", true).limit(10000),
  ]);
  const sqlMissing = Boolean(posts.error);
  const rows = (posts.data ?? []) as PostRow[];
  const buyersByPost = new Map<number, { name: string; amount: number; at: string; first: boolean }[]>();
  for (const b of (buyers.data ?? []) as unknown as { post_id: number; amount: number; is_first: boolean; created_at: string; leads: { first_name: string | null; username: string | null } | null }[]) {
    const list = buyersByPost.get(b.post_id) ?? [];
    list.push({ name: b.leads?.first_name ?? "(silinmiş)", amount: Number(b.amount), at: b.created_at, first: b.is_first });
    buyersByPost.set(b.post_id, list);
  }
  const tagMap = new Map<string, { tag: string; posts: number; starts: number; purchases: number; revenue: number }>();
  for (const p of rows) for (const t of p.tags ?? []) {
    const e = tagMap.get(t) ?? { tag: t, posts: 0, starts: 0, purchases: 0, revenue: 0 };
    e.posts++; e.starts += p.starts; e.purchases += p.purchases; e.revenue += Number(p.revenue); tagMap.set(t, e);
  }
  const source = { channel_post: { n: 0, revenue: 0 }, bot_ad: { n: 0, revenue: 0 }, bot_direct: { n: 0, revenue: 0 }, unlinked: { n: 0, revenue: 0 } };
  for (const s of (sales.data ?? []) as unknown as { amount: number; post_id: number | null; lead_id: string | null; leads: { origin: string | null; source: string | null; landing_url: string | null } | null }[]) {
    const key = s.post_id || s.leads?.origin === "channel_post" ? "channel_post" : !s.lead_id ? "unlinked" : s.leads?.landing_url || (s.leads?.source && s.leads.source !== "telegram_direct") ? "bot_ad" : "bot_direct";
    source[key].n++; source[key].revenue += Number(s.amount);
  }
  return {
    sqlMissing,
    posts: rows.map((p) => ({ ...p, buyers: buyersByPost.get(p.id) ?? [] })),
    templates: templates.data ?? [],
    tags: [...tagMap.values()].sort((a, b) => b.purchases - a.purchases || b.starts - a.starts),
    sources: source,
    plans: BUSINESS.plans.map((p) => ({ key: p.key, name: p.name, priceLabel: p.priceLabel })),
    hasSupport: Boolean(supportContact()),
    hasVipChannel: Boolean(getEnv().TELEGRAM_VIP_CHANNEL_ID),
    botUsername: getEnv().TELEGRAM_BOT_USERNAME,
    mediaBase: `${getEnv().SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`,
  };
}

/** Bota gelen post düğmesi eylemi için tek plan düğmesi. */
export function singlePlanKeyboard(startToken: string, planKey: string): InlineKeyboard | null {
  const plan = getPlan(planKey);
  if (!plan) return null;
  return { inline_keyboard: [[{ text: `${plan.name} · ${plan.priceLabel}`, url: `${getEnv().APP_URL}/api/checkout/redirect?t=${encodeURIComponent(startToken)}&plan=${plan.key}` }]] };
}
