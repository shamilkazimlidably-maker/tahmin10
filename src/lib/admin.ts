import { getEnv } from "./env";
import { sendText } from "./telegram";

/** Message to the owner's Telegram. Silent no-op if TELEGRAM_ADMIN_CHAT_ID is not set. Never throws. */
export async function notifyAdmin(text: string): Promise<void> {
  try {
    const chatId = getEnv().TELEGRAM_ADMIN_CHAT_ID;
    if (!chatId) return;
    await sendText(chatId, text);
  } catch (error) {
    console.error("[admin notify]", error);
  }
}

export function isAdminChat(chatId: number | string): boolean {
  const admin = getEnv().TELEGRAM_ADMIN_CHAT_ID;
  return Boolean(admin) && String(chatId) === String(admin);
}
