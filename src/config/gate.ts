/**
 * ZİYARETÇİ FİLTRESİ — kim ana açılış sayfasını, kim "Futbol Veri Merkezi" sayfasını görür.
 * Varsayılanlar burada; panel → "Ziyaretçi Filtresi" bölümünden değiştirilir (src/lib/settings.ts uygular).
 */
export const GATE = {
  /** Kapalıysa herkes ana sayfayı görür. */
  enabled: true,
  /** Virgülle ayrılmış ülke kodları (ISO-3166-1 alpha-2). Bu ülkelerin dışından gelenler güvenli sayfayı görür. Boş = ülke kontrolü yok. */
  allowedCountries: "TR,AZ",
  /** Ülke tespit edilemezse (Vercel dışı / yerel geliştirme): "allow" ana sayfa, "safe" güvenli sayfa. */
  unknownCountry: "allow" as "allow" | "safe",
  /** Tarayıcı robotları, link önizleme botları, otomasyon araçları güvenli sayfayı görür. */
  botsToSafe: true,
  /** Ek anahtar kelimeler (virgülle): user-agent içinde geçerse bot sayılır. */
  extraBotKeywords: "",
  /** Acil durum: HERKES güvenli sayfayı görür (ana sayfayı geçici olarak kapatmak için). */
  forceSafe: false,
};
export type GateSettings = typeof GATE;

const BOT_RE =
  /bot\b|bot\/|crawl|spider|slurp|facebookexternalhit|facebot|meta-external|adsbot|mediapartners|bingpreview|yandex|duckduck|baidu|petalbot|bytespider|gptbot|claudebot|anthropic|openai|perplexity|applebot|twitterbot|linkedinbot|telegrambot|whatsapp\/|discordbot|slackbot|skypeuripreview|pinterest|embedly|quora link|vkshare|validator|ia_archiver|archive\.org|uptimerobot|monitor|pingdom|statuscake|site24x7|newrelic|datadog|checkly|headless|phantomjs|selenium|puppeteer|playwright|lighthouse|pagespeed|gtmetrix|screaming frog|ahrefs|semrush|mj12|dotbot|curl\/|wget\/|python|httpclient|java\/|go-http-client|okhttp|axios\/|node-fetch|libwww|scrapy|apache-httpclient|postmanruntime|insomnia/i;

/** Boş / çok kısa user-agent de bot sayılır. Instagram / Facebook uygulama içi tarayıcılar (FBAN, FBAV, Instagram) GERÇEK ziyaretçidir ve eşleşmez. */
export function isBotUserAgent(userAgent: string, extraKeywords = ""): boolean {
  const ua = userAgent.trim();
  if (ua.length < 12) return true;
  if (BOT_RE.test(ua)) return true;
  const lower = ua.toLowerCase();
  return extraKeywords
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length >= 3)
    .some((w) => lower.includes(w));
}
