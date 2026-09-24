/**
 * AÇILIŞ SAYFASI metinleri (Türkçe). Varsayılanlar burada; sahip bunları yönetim paneli → "Açılış Sayfası"
 * bölümünden düzenler. Değişkenler: {brand} {frequency} {age}. Sayfa en geç 2 dakika içinde yenilenir.
 * "Ne alırsın" listesi İşletme Bilgileri → Ücretsiz kanal → "Kanalda neler paylaşılıyor?" bölümünden gelir.
 */
export const LANDING = {
  eyebrow: "Telegram'da ücretsiz kanal",
  headline1: "Günde 1 futbol tahmini.",
  headlineHighlight: "Veriye dayalı.",
  headline2: "Ücretsiz.",
  lead: "Her gün rakamlara göre bir maç seçiyor, tahmini önerilen marketle birlikte Telegram'ına gönderiyoruz. Banko yok, garanti yok; analiz var.",
  cta: "Telegram'da Aç",
  trust1: "Ücretsiz",
  trust2: "Kayıt yok",
  trust3: "Kart yok",
  micro: "Asistanımızla kısa bir sohbet açılır; kanal erişimini o verir.",
  fallbackHint: "Açılmadı mı? Telegram'ı açmak için buraya dokun",
  previewTitle: "Sana böyle gelir",
  previewLabel: "Günün ücretsiz tahmini",
  previewCaption: "Biçim örneğidir. Gerçek tahmin her gün kanalda paylaşılır.",
  previewAvatar: "10",
  previewSmall: "kanal",
  previewRow1: "Maç",
  previewRow2: "Market",
  previewRow3: "Neden",
  previewTime: "her gün",
  brandMark: "",
  ageBadge: "",
  howTitle: "Nasıl çalışır?",
  step1Title: "Düğmeye dokun",
  step1Text: "Telegram, {brand} asistanıyla bir sohbette açılır.",
  step2Title: "Ücretsiz kanala katıl",
  step2Text: "Erişimi asistan verir. Kanalda {frequency} alırsın.",
  step3Title: "Baskı olmadan takip et",
  step3Text: "Bir gün günün tam listesini istersen VIP var. İstemezsen ücretsiz kanal aynen devam eder.",
  benefitsTitle: "Ücretsiz ne alırsın?",
  honestTitle: "Açık konuşalım",
  honestText: "Tahmin analizdir, garanti değil. Maçları veriye göre seçiyoruz ama futbol futboldur: kimse her zaman tutturamaz, biz de dahil. Asla ihtiyacın olan parayla oynama.",
  faqTitle: "Kısa sorular",
  faq1Q: "Gerçekten ücretsiz mi?",
  faq1A: "Evet. Ücretsiz kanal hiçbir ücret ya da kart istemez. Günün tam listesini isteyenler için ücretli bir VIP var ama kimse abone olmak zorunda değil.",
  faq2Q: "Tahminler her zaman tutar mı?",
  faq2A: "Hayır. Futbolda kimse sonuç garanti edemez; banko diye bir şey yok, öyle diyen herkesten uzak dur. Biz maçları veriye göre seçip önerilen marketi gösteriyoruz. Karar her zaman senin.",
  faq3Q: "Bahis sitesi misiniz?",
  faq3A: "Hayır. Bahis oynatmıyoruz, hiçbir bahis sitesi önermiyoruz, sadece analiz ve tahmin paylaşıyoruz. Oynayıp oynamamak ve nerede oynayacağın senin kararın; yalnızca Türkiye'de yasal olan platformları kullan.",
  faq4Q: "Neden bir asistanla sohbet açılıyor?",
  faq4A: "Kanal linkini o veriyor ve sorularını cevaplıyor. Bir sanal asistandır; mesaj almak istemediğinde DUR yazman yeterli.",
  cta2: "Bugünün ücretsiz tahminini istiyorum",
  stickyText: "Günde 1 ücretsiz tahmin",
  footer: "{age} yaş üstü için futbol hakkında bilgilendirici içerik. {brand} bir bahis sitesi değildir, bahis oynatmaz, herhangi bir bahis platformu önermez ve sonuç ya da kazanç garantisi vermez. Sorumlu oyna. Oyun bir sorun hâline geldiyse destek al: Yeşilay YEDAM Danışma Hattı 115.",
};
export type LandingKey = keyof typeof LANDING;

/** Panelde boş bırakılabilen satırlar; boşsa o öğe sayfadan kalkar. */
export const LANDING_OPTIONAL_KEYS: LandingKey[] = [
  "eyebrow", "headlineHighlight", "headline2", "micro", "trust1", "trust2", "trust3", "fallbackHint", "previewCaption", "stickyText", "brandMark", "ageBadge", "previewSmall", "previewTime",
  "faq1Q", "faq1A", "faq2Q", "faq2A", "faq3Q", "faq3A", "faq4Q", "faq4A",
];
