/**
 * GELEN KUTUSU AYARLARI. Panel → Gelen Kutusu → Ayarlar (src/lib/settings.ts uygular).
 *  mode "human": bota gelen mesajlar panele düşer, cevabı operatör yazar; yapay zekâ yalnızca yardım eder.
 *  mode "ai":    eski davranış — yapay zekâ satış asistanı kendisi cevap verir.
 */
export const INBOX = {
  mode: "human" as "human" | "ai",
  /** Yeni müşteri mesajında sahibin Telegram'ına kısa bildirim (panel linkiyle). */
  notifyTelegram: true,
  /** Aynı kişi için iki bildirim arasında en az kaç dakika. */
  notifyCooldownMinutes: 15,
  /** Kişi kanala girince otomatik gönderilen kısa mesaj (boş = gönderme; operatör kendisi yazar). */
  joinedMessage: "Kanala hoş geldin 🙌 Bugünün tahmini kanalda. Aklına takılan olursa buradan yaz, ben buradayım.",
  /** Operatörün adı (Telegram'a gitmez; panelde görünür). */
  agentName: "",
};
export type InboxSettings = typeof INBOX;
