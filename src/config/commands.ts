/**
 * BOT KOMUTLARI ve "satın almak istiyor" anahtar kelimeleri. Panel → Gelişmiş Ayarlar → Komutlar.
 * Komut adları: 1–32 karakter, yalnızca a-z 0-9 _ (Telegram kuralı). Eski adlar (/planos /canal /parar /stop /vip) her zaman çalışır.
 */
export const COMMANDS = {
  plans: "planlar",
  plansDesc: "VIP planlarını gör",
  channel: "kanal",
  channelDesc: "Ücretsiz kanal",
  stop: "dur",
  stopDesc: "Mesaj almayı bırak",
  startDesc: "Başla",
  /** Bunlardan biri geçerse kişi VIP/fiyat/nasıl alınır SORUYOR demektir → bot her aşamada planları verebilir. Virgülle. */
  directBuyingKeywords: "fiyat, ücret, kaç para, kaç tl, kaç lira, ne kadar, kaça, vip, premium, abone, abonelik, üyelik, paket, plan, nasıl katıl, nasıl gir, nasıl al, nasıl öde, nasıl ödeme, satın al, almak istiyorum, katılmak istiyorum, ödeme, link at, linki ver, link gönder, link yolla",
};
export type CommandSettings = typeof COMMANDS;

const norm = (s: string) => s.replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase();
let cache: { sig: string; re: RegExp | null } | null = null;

/** Kişi VIP / fiyat / nasıl alınır diye soruyor mu? */
export function isDirectBuying(text: string): boolean {
  const sig = COMMANDS.directBuyingKeywords;
  if (!cache || cache.sig !== sig) {
    const words = sig.split(",").map((w) => norm(w.trim())).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*"));
    cache = { sig, re: words.length ? new RegExp(words.join("|")) : null };
  }
  return Boolean(cache.re?.test(norm(text)));
}

/** Telegram'a kaydedilen komut listesi. */
export function botCommandList(): { command: string; description: string }[] {
  const ok = (c: string) => /^[a-z0-9_]{1,32}$/.test(c);
  return [
    { command: "start", description: COMMANDS.startDesc || "Başla" },
    { command: ok(COMMANDS.plans) ? COMMANDS.plans : "planlar", description: COMMANDS.plansDesc || "VIP planlarını gör" },
    { command: ok(COMMANDS.channel) ? COMMANDS.channel : "kanal", description: COMMANDS.channelDesc || "Ücretsiz kanal" },
    { command: ok(COMMANDS.stop) ? COMMANDS.stop : "dur", description: COMMANDS.stopDesc || "Mesaj almayı bırak" },
  ];
}
