import { getEnv } from "./env";
import { BUSINESS } from "../config/business";
import { TEXTS } from "../config/texts";
import { INTEGRATION_OVERRIDES } from "./integrations";
import { truncate } from "./util";

export class TelegramError extends Error {
  constructor(
    public method: string,
    public code: number,
    public description: string,
  ) {
    super(`Telegram ${method} failed (${code}): ${description}`);
  }
  /** The user blocked the bot, deleted their account, or never started it. */
  get isBlocked(): boolean {
    return (
      this.code === 403 ||
      /bot was blocked|user is deactivated|chat not found|bot can't initiate/i.test(this.description)
    );
  }
}

type ApiResponse<T> = { ok: boolean; result?: T; description?: string; error_code?: number; parameters?: { retry_after?: number } };

export async function tg<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
  const env = getEnv();
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = (await response.json()) as ApiResponse<T>;
      if (data.ok) return data.result as T;
      // Flood control: wait once if Telegram tells us how long.
      const retryAfter = data.parameters?.retry_after;
      if (data.error_code === 429 && retryAfter && retryAfter <= 5 && attempt === 0) {
        await new Promise((r) => setTimeout(r, retryAfter * 1000 + 200));
        continue;
      }
      throw new TelegramError(method, data.error_code ?? response.status, data.description ?? response.statusText);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new TelegramError(method, 429, "rate limited");
}

export type InlineKeyboard = { inline_keyboard: { text: string; url?: string; callback_data?: string }[][] };

export async function sendText(
  chatId: string | number,
  text: string,
  options: { keyboard?: InlineKeyboard; html?: boolean } = {},
): Promise<{ message_id: number }> {
  return tg<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text: truncate(text, 4000),
    // AI text is sent as plain text: a stray "<" or "&" can never break delivery.
    ...(options.html ? { parse_mode: "HTML" } : {}),
    link_preview_options: { is_disabled: true },
    ...(options.keyboard ? { reply_markup: options.keyboard } : {}),
  });
}

export async function sendTyping(chatId: string | number): Promise<void> {
  await tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => undefined);
}

export async function answerCallback(id: string, text?: string, alert = false): Promise<void> {
  await tg("answerCallbackQuery", { callback_query_id: id, text, show_alert: alert }).catch(() => undefined);
}

export type ChatMember = { status: string; is_member?: boolean };

export function isActiveMember(member: ChatMember | null | undefined): boolean {
  if (!member) return false;
  if (["creator", "administrator", "member"].includes(member.status)) return true;
  return member.status === "restricted" && member.is_member === true;
}

/** Requires the bot to be an ADMIN of the channel. */
export async function isMemberOf(channelId: string, userId: number | string): Promise<boolean> {
  try {
    const member = await tg<ChatMember>("getChatMember", { chat_id: channelId, user_id: Number(userId) });
    return isActiveMember(member);
  } catch (error) {
    if (error instanceof TelegramError && /user not found|PARTICIPANT_ID_INVALID|member not found/i.test(error.description)) {
      return false;
    }
    throw error;
  }
}

export async function createSingleUseInvite(channelId: string, name: string): Promise<string> {
  const result = await tg<{ invite_link: string }>("createChatInviteLink", {
    chat_id: channelId,
    name: truncate(name, 32),
    member_limit: 1,
    expire_date: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
  });
  return result.invite_link;
}

/** Remove from a channel without leaving a permanent ban (so they can re-subscribe later). */
export async function removeFromChannel(channelId: string, userId: number | string): Promise<void> {
  await tg("banChatMember", { chat_id: channelId, user_id: Number(userId), revoke_messages: false });
  await tg("unbanChatMember", { chat_id: channelId, user_id: Number(userId), only_if_banned: true });
}

export function freeChannelKeyboard(): InlineKeyboard {
  const env = getEnv();
  return {
    inline_keyboard: [
      [{ text: TEXTS.btnJoinFree, url: INTEGRATION_OVERRIDES.freeChannelUrl || env.TELEGRAM_FREE_CHANNEL_URL }],
      [{ text: TEXTS.btnJoined, callback_data: "check_free" }],
    ],
  };
}

export function plansKeyboard(startToken: string): InlineKeyboard {
  const env = getEnv();
  return {
    inline_keyboard: BUSINESS.plans.map((plan) => [
      {
        text: `${plan.name} · ${plan.priceLabel}`,
        url: `${env.APP_URL}/api/checkout/redirect?t=${encodeURIComponent(startToken)}&plan=${plan.key}`,
      },
    ]),
  };
}

export async function registerWebhook(): Promise<Record<string, unknown>> {
  const env = getEnv();
  await tg("setWebhook", {
    url: `${env.APP_URL}/api/telegram/webhook`,
    secret_token: env.TELEGRAM_WEBHOOK_SECRET,
    // chat_member lets us SEE people joining/leaving the channels without them pressing a button.
    allowed_updates: ["message", "callback_query", "chat_member", "my_chat_member"],
    drop_pending_updates: false,
    max_connections: 40,
  });
  await tg("setMyCommands", {
    commands: [
      { command: "start", description: "Başla" },
      { command: "planlar", description: "VIP planlarını gör" },
      { command: "kanal", description: "Ücretsiz kanal" },
      { command: "dur", description: "Mesaj almayı bırak" },
    ],
  }).catch(() => undefined);
  return tg<Record<string, unknown>>("getWebhookInfo", {});
}

export async function getMe(): Promise<{ id: number; username?: string }> {
  return tg("getMe", {});
}
