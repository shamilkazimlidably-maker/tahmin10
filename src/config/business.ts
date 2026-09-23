import { INTEGRATION_OVERRIDES } from "../lib/integrations";

/**
 * =====================================================================
 *  DOĞRULANMIŞ İŞLETME BİLGİLERİ  —  ✏️  BURAYI GERÇEK BİLGİLERİNİZLE DOLDURUN
 *  (ya da yayına aldıktan sonra /admin → İşletme Bilgileri sekmesinden düzenleyin)
 * =====================================================================
 *
 * Satış asistanı müşteriye YALNIZCA burada yazanları söyleyebilir.
 * `null` veya boş liste = "bilinmiyor": bot uydurmaz, "ekibe sorup döneyim" der.
 *
 * Fiyatlar burada botun SÖYLEDİĞİ fiyattır. Müşterinin gerçekte ödediği tutar
 * Whop'taki plandır — ikisini aynı tutun. Para birimi: Türk lirası (TRY).
 */

export type PlanKey = "weekly" | "monthly" | "three_months";

export type VipPlan = {
  key: PlanKey;
  /** Düğme yazısı + botun planı nasıl adlandırdığı. */
  name: string;
  /** Müşteriye fiyat tam olarak böyle yazılır. */
  priceLabel: string;
  /** Sayısal fiyat (Meta "InitiateCheckout" değeri için). */
  price: number;
  /** "recurring" = Whop müşteri iptal edene kadar otomatik yeniler. */
  billingType: "recurring" | "one_time";
  /** Ödemenin nasıl anlatılacağı. Otomatik yenilemeyi asla gizlemeyin. */
  billingLabel: string;
  /** Bu plan kime uygun — botun kullanabileceği tek kısa cümle. */
  bestFor: string;
  /** Whop plan ID'sini (plan_...) VEYA planın ödeme linkini tutan ortam değişkeni. */
  envVar: "WHOP_PLAN_WEEKLY" | "WHOP_PLAN_MONTHLY" | "WHOP_PLAN_3_MONTHS";
};

export type TrackRecordPeriod = { label: string; total: number; won: number; lost: number; void: number; averageOdds: number; profitUnits: number };

export const BUSINESS = {
  brand: "TAHMİN10",
  currency: "TRY",
  minimumAge: 18,

  freeChannel: {
    name: "TAHMİN10 Ücretsiz Kanal",
    whatWePost: [
      "Günde 1 ücretsiz futbol tahmini, veriye dayalı",
      "Maç için önerilen market (ör. maç sonucu, alt/üst, karşılıklı gol)",
      "Maçlar mevcut verilere göre seçilir, takıma ya da lige göre değil",
      "Gerektiğinde kısa bir gerekçe / bağlam",
    ],
    postingFrequency: "günde 1 ücretsiz tahmin",
    /** Dürüst konumlandırma: ücretsiz "kötü" değildir, aynı yöntemin bir örneğidir. */
    positioning:
      "Ücretsiz tahmin VIP ile aynı yöntemle hazırlanır. VIP'in farkı kalite değil, hacim ve günün eksiksiz seçkisidir. Sadece ücretsiz kanalda olan kişi günün tam listesini almaz.",
  },

  vip: {
    name: "TAHMİN10 VIP",
    delivery: "Özel Telegram VIP kanalına erişim. Ödeme onaylanır onaylanmaz link buradan, sohbetin içinden gönderilir.",
    /** YALNIZCA GERÇEK faydalar. Bot bu listeyi sayar, başka bir şey eklemez. */
    benefits: [
      "Günün eksiksiz seçkisi: günde yaklaşık 8–10 tahmin, hepsi veriye dayalı",
      "Farklı marketlerde daha fazla fırsat",
      "Uygun seçimler olduğunda kombine önerisi (TAHMİN10 KOMBİNE)",
      "Ücretsiz kanaldan çok daha kapsamlı günlük takip",
    ],
    volume: "Günde yaklaşık 8–10 tahmin — o günkü maçlara ve fırsatların kalitesine göre değişir",
    /** Bilerek satış argümanı DEĞİL: VIP'i ücretsizden ayırmak için lig/takım adı kullanılmaz. */
    coverage: "Maçlar lige göre değil veriye göre seçilir. VIP'in farkı olarak belirli bir lig ya da takım SÖYLEMEYİN.",
    marketTypes:
      "O gün verinin desteklediği marketler: maç sonucu (MS), çifte şans, alt/üst gol, karşılıklı gol (KG var/yok), handikap, takım golü, korner, kart ve diğerleri. Her market her gün çıkmaz — belirli bir marketi her gün vaat etmeyin.",
    combos: "Tekli tahminlere ek olarak, uygun seçimler olduğunda günün tahminlerinden oluşan bir kombine önerisi (TAHMİN10 KOMBİNE) paylaşılabilir. Her gün değil, yalnızca uygun seçimler varsa.",
    plansDifferOnlyInDuration: true,
    /** Örn: "Whop üzerinden 7 gün içinde iade." null = bot ekibe soracağını söyler. */
    refundPolicy: null as string | null,
    cancellation: "Abonelik otomatik yenilenir; kişi Whop hesabından istediği an iptal edebilir. Erişim, ödenmiş dönemin sonuna kadar devam eder.",

    /**
     * ⚠️ YALNIZCA GERÇEKSE DOLDURUN. Bu sayılar müşterilere söylenir; isteyen olursa kaydı gösterebilmelisiniz.
     * `null` = bot asla sonuç / isabet oranı söylemez. İsabet ve ROI aşağıdaki sayılardan HESAPLANIR
     * (iptaller isabete katılmaz), böylece her dönem aynı formülle anlatılır.
     */
    trackRecord: null as { periods: TrackRecordPeriod[]; scope: string; disclaimer: string } | null,

    /** ⚠️ YALNIZCA GERÇEK ve izinli yorumlar. Kelimesi kelimesine aktarılır. Boş liste = bot yorumlardan hiç söz etmez. */
    testimonials: [] as { author: string; text: string }[],

    /** Gerçek ve şu an geçerli bir kampanya. null = bot asla indirimden söz etmez. */
    activePromotion: null as string | null,
  },

  /* ✏️ ÖRNEK FİYATLAR — Whop'taki gerçek fiyatlarınızla DEĞİŞTİRİN. */
  plans: [
    {
      key: "weekly",
      name: "Haftalık VIP",
      priceLabel: "haftalık ₺399",
      price: 399,
      billingType: "recurring",
      billingLabel: "Haftalık abonelik — iptal edene kadar her hafta otomatik yenilenir.",
      bestFor: "VIP'i en düşük giriş tutarıyla denemek isteyenler için.",
      envVar: "WHOP_PLAN_WEEKLY",
    },
    {
      key: "monthly",
      name: "Aylık VIP",
      priceLabel: "aylık ₺1.199",
      price: 1199,
      billingType: "recurring",
      billingLabel: "Aylık abonelik — iptal edene kadar her ay otomatik yenilenir.",
      bestFor: "Maçları her hafta takip edenler için.",
      envVar: "WHOP_PLAN_MONTHLY",
    },
    {
      key: "three_months",
      name: "3 Aylık VIP",
      priceLabel: "3 ayda bir ₺2.999",
      price: 2999,
      billingType: "recurring",
      billingLabel: "3 aylık abonelik — iptal edene kadar her 3 ayda bir otomatik yenilenir.",
      bestFor: "Devam edeceğini bilenler için aylık maliyeti en düşük seçenek.",
      envVar: "WHOP_PLAN_3_MONTHS",
    },
  ] satisfies VipPlan[] as VipPlan[],

  /** Beğendiğiniz üsluptaki cümleler. Bot bunlardan ilham alır — ezberden okumaz. */
  voiceExamples: [
    "İstersen VIP nasıl işliyor kısaca anlatayım.",
    "Ücretsiz kanalda zaten günde 1 tahmin alıyorsun.",
    "VIP'te günün tam listesine ulaşıyorsun.",
    "Planları göstereyim mi?",
    "Erişimi hemen gönderebilirim.",
    "Bütün planlar aynı erişimi veriyor; sadece süre değişiyor.",
    "Banko diye bir şey yok; veriye dayalı analiz var.",
  ],

  /** Yerleşik güvenlik kurallarına EK olarak botun ASLA söylememesi gerekenler. */
  neverSay: [
    "Tekrarlanan baskı: 'hemen al', 'son şans', 'kaçırma', 'acele et', 'son yerler'",
    "'Banko', 'kesin', 'şaşmaz', 'garanti' gibi kesinlik ifadeleri",
    "Bahsi para kazanmanın garantili ya da güvenilir bir yolu gibi sunmak",
    "Kaybettiği için daha fazla oynamaya teşvik etmek",
    "Herhangi bir bahis sitesi, platform ya da uygulama önermek / adını vermek (yasal olsun olmasın)",
    "Uydurma referans, müşteri hikâyesi, sonuç ya da sayı",
    "Bir planın diğerinden daha iyi ya da daha fazla tahmin verdiğini, daha yüksek isabetli olduğunu söylemek",
  ] as string[],
};

export function getPlan(key: string): VipPlan | undefined {
  return BUSINESS.plans.find((p) => p.key === key);
}

/** SUPPORT_USERNAME=@destek_hesabi  veya  SUPPORT_URL=https://t.me/destek_hesabi (Vercel ortam değişkenleri). */
export function supportContact(): { label: string; url: string | null } | null {
  const username = (INTEGRATION_OVERRIDES.supportUsername || process.env.SUPPORT_USERNAME)?.trim().replace(/^@/, "");
  const url = process.env.SUPPORT_URL?.trim();
  if (username) return { label: `@${username}`, url: `https://t.me/${username}` };
  if (url) return { label: "destek", url };
  return null;
}

const fmt = (n: number, digits = 1) => n.toFixed(digits).replace(".", ",");

export function trackRecordStats(p: TrackRecordPeriod) {
  const decided = p.won + p.lost;
  return {
    winRate: decided ? (p.won / decided) * 100 : 0,
    roi: p.total ? (p.profitUnits / p.total) * 100 : 0,
  };
}

/** Botun yazmasına izin verilen yüzdeler (güvenlik filtresi bunları kullanır). */
export function allowedStatNumbers(): string[] {
  const t = BUSINESS.vip.trackRecord;
  if (!t) return [];
  return t.periods.flatMap((p) => {
    const s = trackRecordStats(p);
    return [fmt(s.winRate), fmt(s.roi)];
  });
}

function renderTrackRecord(): string {
  const t = BUSINESS.vip.trackRecord;
  if (!t) return "VERİ YOK — asla isabet oranı, kazanç ya da geçmiş sonuç söyleme";
  const lines = t.periods.map((p) => {
    const s = trackRecordStats(p);
    return `  • ${p.label}: ${p.total} tahmin — ${p.won} tutan, ${p.lost} tutmayan, ${p.void} iptal; isabet %${fmt(s.winRate)} (iptaller hariç); ortalama oran ${fmt(p.averageOdds, 2)}; net +${fmt(p.profitUnits)} birim; ROI %${fmt(s.roi)}`;
  });
  return [
    `(${t.scope})`,
    ...lines,
    `  KURALLAR: bu sayıları yalnızca kişi sonuç / geçmiş / güven SORDUĞUNDA söyle. Sayıları aynen, her zaman dönemiyle birlikte kullan. Asla topla, yukarı yuvarla, gelecek kazancı hesaplama, "birim"i liraya çevirme. Her zaman şu cümleyle bitir: "${t.disclaimer}"`,
  ].join("\n");
}

/** Her satış promptuna eklenen bilgi bloğu. */
export function renderFacts(): string {
  const b = BUSINESS;
  const unknown = "BİLGİ YOK (şu an bu bilginin elinde olmadığını, ekibe sorup dönebileceğini söyle)";
  const support = supportContact();
  const lines: string[] = [
    `Marka: ${b.brand}`,
    `Yaş sınırı: ${b.minimumAge}`,
    `Ödeme: Whop üzerinden, Türk lirası ile, banka/kredi kartıyla; kart bilgileri bize ulaşmaz. Ödeme yalnızca sistemin gönderdiği plan düğmelerinden yapılır. Havale/EFT ya da başka bir yöntem: ${unknown}`,
    `İnsan desteği: ${
      support ? "ekibin bir iletişim hesabı var; next_action \"handoff_human\" kullan, iletişimi SİSTEM gönderir (kendin yazma)" : "next_action \"handoff_human\" kullan, ekip haberdar edilir"
    }`,
    "",
    `ÜCRETSİZ KANAL — ${b.freeChannel.name}`,
    `Ne paylaşılır: ${b.freeChannel.whatWePost.join("; ")}`,
    `Sıklık: ${b.freeChannel.postingFrequency ?? unknown}`,
    `Konumlandırma: ${b.freeChannel.positioning}`,
    "",
    `VIP — ${b.vip.name}`,
    `Gerçek faydalar: ${b.vip.benefits.join("; ")}`,
    `Tahmin sayısı: ${b.vip.volume ?? unknown}`,
    `Ligler: ${b.vip.coverage ?? unknown}`,
    `Marketler: ${b.vip.marketTypes ?? unknown}`,
    `Kombine: ${b.vip.combos ?? unknown}`,
    `Erişim nasıl verilir: ${b.vip.delivery}`,
    `Planlar arasındaki fark: ${
      b.vip.plansDifferOnlyInDuration
        ? "hepsi AYNI VIP kanalına, aynı tahminlere erişim verir; yalnızca ödeme / erişim süresi değişir"
        : "planlar arasında farklar var — yalnızca her planın açıklamasında yazanı anlat"
    }`,
    `İptal: ${b.vip.cancellation ?? unknown}`,
    `İade: ${b.vip.refundPolicy ?? unknown}`,
    `Geçmiş sonuçlar: ${renderTrackRecord()}`,
    `İzinli müşteri yorumları (en fazla BİR tanesini, kelimesi kelimesine ve isimle; yalnızca kişi kullananların fikrini sorarsa): ${
      b.vip.testimonials.length ? b.vip.testimonials.map((t) => `${t.author}: "${t.text}"`).join(" | ") : "YOK — asla yorum aktarma"
    }`,
    `Aktif kampanya: ${b.vip.activePromotion ?? "YOK — asla indirim, kupon kodu, kontenjan ya da süre sınırından söz etme"}`,
    "",
    "PLANLAR (fiyatlar kesindir — asla değiştirme; hepsi aboneliktir, otomatik yenilendiğini her zaman açıkça söyle):",
    ...b.plans.map((p) => `- ${p.name}: ${p.priceLabel}. ${p.billingLabel} ${p.bestFor}`),
  ];
  if (b.voiceExamples.length) lines.push("", "BİZİM ÜSLUBUMUZDAKİ CÜMLELER (ilham, ezber değil):", ...b.voiceExamples.map((x) => `- ${x}`));
  if (b.neverSay.length) lines.push("", "ASLA:", ...b.neverSay.map((x) => `- ${x}`));
  return lines.join("\n");
}
