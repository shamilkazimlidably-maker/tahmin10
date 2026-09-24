/**
 * =====================================================================
 *  FUNNEL RULES — deterministic. The AI proposes, this file decides.
 * =====================================================================
 */

export type Stage =
  | "NEW"
  | "DISCOVERY"
  | "FREE_INVITED"
  | "ENGAGED"
  | "VIP_OFFERED"
  | "CHECKOUT"
  | "PAID"
  | "NOT_INTERESTED";

export const FUNNEL = {
  /** 1 = /start'a anında sabit karşılama + ücretsiz kanal düğmesi (yapay zekâ beklenmez). 0 = eski davranış (yapay zekâ selam verir). */
  instantWelcome: 1,
  /** User replies before the AI is ALLOWED to invite to the free channel. */
  minRepliesBeforeFreeInvite: 2,
  /** User replies after which the invite is sent even if the AI did not choose to. */
  forceFreeInviteAfterReplies: 4,

  /** User replies AFTER joining the free channel before a proactive VIP offer. */
  minRepliesAfterJoinBeforeOffer: 2,
  /** 0–100. See score.ts: 100 = SCORE_TARGET_POINTS of evidence. */
  vipScoreThreshold: 60,
  /** Turns the lead stays eligible before the AI is told the offer is DUE. */
  offerDueAfterEligibleTurns: 2,
  /** Proactive offers per lead (answering a direct question never counts). */
  maxProactiveOffers: 2,
  offerCooldownHours: 72,

  /**
   * If the person ASKS about VIP / price / how to buy, we always answer and
   * show plans — even before the free channel. Blocking a buyer is bad sales
   * and bad manners.
   */
  alwaysAnswerDirectBuyingQuestions: true,

  /** Messages of history sent to the model each turn. */
  historyMessages: 24,

  /** A silent, unpaid lead is closed as lost (and analysed) after this. */
  closeAsLostAfterSilentDays: 7,
} as const;

/* ------------------------------------------------------------------ */
/*  SCORING SIGNALS                                                   */
/* ------------------------------------------------------------------ */

export type SignalSource = "ai" | "system";

export type SignalDef = {
  key: string;
  weight: number;
  source: SignalSource;
  /** Shown to the model (Turkish) for "ai" signals. */
  description: string;
};

/**
 * 100 points on the 0–100 score = this many weighted points of evidence.
 * Example that reaches exactly 60 (the threshold):
 *   follows_football 3 + uses_predictions 4 + joined_free_channel 6 + wants_more_content 5 = 18 → 60
 */
export const SCORE_TARGET_POINTS = 30;

export const SIGNALS = [
  // ---- FIT (who they are) ------------------------------------------------
  { key: "follows_football", weight: 3, source: "ai", description: "Takip ettiği takımlardan, maçlardan ya da liglerden söz ediyor." },
  { key: "uses_predictions", weight: 4, source: "ai", description: "Tahmin/kupon kullandığını ya da kullanmak istediğini söylüyor." },
  { key: "frequent_user", weight: 3, source: "ai", description: "Tahminleri sık takip ediyor (her hafta, her maç günü, her gün)." },
  { key: "follows_specific_league", weight: 2, source: "ai", description: "Belirli bir lig ya da takım söylüyor." },
  { key: "values_analysis", weight: 3, source: "ai", description: "Sadece 'şunu oyna' değil; analiz, istatistik ya da gerekçe istiyor." },
  { key: "compares_sources", weight: 2, source: "ai", description: "Zaten başka tahmin kanallarını / kaynaklarını takip ediyor." },
  { key: "paid_before", weight: 4, source: "ai", description: "Daha önce tahmin, VIP grup ya da benzeri bir içeriğe para ödemiş." },

  // ---- INTENT (what they want now) --------------------------------------
  { key: "wants_more_content", weight: 5, source: "ai", description: "Daha fazla tahmin/analiz istiyor ya da ücretsizin az olduğunu söylüyor." },
  { key: "positive_reaction", weight: 3, source: "ai", description: "Ücretsiz içeriğe ya da bir açıklamaya olumlu tepki veriyor." },
  { key: "asks_about_vip", weight: 6, source: "ai", description: "VIP'i kendiliğinden soruyor." },
  { key: "asks_whats_included", weight: 5, source: "ai", description: "VIP'te ne olduğunu soruyor." },
  { key: "asks_about_price", weight: 7, source: "ai", description: "Fiyat / ücret / kaç para diye soruyor." },
  { key: "asks_about_access", weight: 4, source: "ai", description: "Nasıl girileceğini, nasıl ödeneceğini ya da erişimin nasıl geleceğini soruyor." },
  { key: "asks_about_results", weight: 2, source: "ai", description: "Sonuçları, geçmişi ya da isabet oranını soruyor." },
  { key: "explicit_purchase_intent", weight: 9, source: "ai", description: "Açıkça abone olmak / satın almak / VIP'e girmek istediğini söylüyor." },
  { key: "objection_resolved", weight: 3, source: "ai", description: "Bir sorusu cevaplandı ve kişi devam etti." },
  { key: "renewed_interest", weight: 4, source: "ai", description: "Tereddüt ya da ret sonrasında VIP'i yeniden soruyor." },

  // ---- FRICTION (negative) ----------------------------------------------
  { key: "objection_price", weight: -2, source: "ai", description: "Pahalı buluyor ya da şu an ödeyemeyeceğini söylüyor." },
  { key: "objection_trust", weight: -2, source: "ai", description: "Güvenmiyor (dolandırıcılık mı, gerçekten tutuyor mu, daha önce kandırılmış)." },
  { key: "objection_value", weight: -2, source: "ai", description: "VIP ile ücretsiz arasında fark görmüyor." },
  { key: "explicit_no", weight: -12, source: "ai", description: "Açıkça VIP istemediğini söylüyor." },

  // ---- BEHAVIOUR (verified by the backend, never by the AI) --------------
  { key: "returned_to_bot", weight: 3, source: "system", description: "Başka bir gün yeniden yazdı." },
  { key: "joined_free_channel", weight: 6, source: "system", description: "Ücretsiz kanala giriş Telegram tarafından doğrulandı." },
  { key: "clicked_vip_plan", weight: 7, source: "system", description: "Bir VIP planına tıkladı." },
  { key: "checkout_started", weight: 8, source: "system", description: "Whop'ta ödeme sayfası oluşturuldu." },
] as const satisfies readonly SignalDef[];

export type SignalKey = (typeof SIGNALS)[number]["key"];

export const AI_SIGNAL_KEYS: string[] = SIGNALS.filter((s) => s.source === "ai").map((s) => s.key);

/** Any of these in the CURRENT user message unlocks the plans immediately. */
export const DIRECT_BUYING_SIGNALS: SignalKey[] = [
  "asks_about_vip",
  "asks_whats_included",
  "asks_about_price",
  "asks_about_access",
  "explicit_purchase_intent",
];

/** Deterministic backup for the above, in case the model misses it. */
export const DIRECT_BUYING_REGEX =
  /fiyat|ücret|kaç\s*(para|tl|lira)|ne\s*kadar|kaça|vip|premium|abone|abonelik|üyelik|paket|plan|nasıl\s*(katıl|gir|al|öde|ödeme)|satın\s*al|almak\s*istiyorum|katılmak\s*istiyorum|ödeme|link(i|ini)?\s*(at|ver|gönder|yolla)/i;

/* ------------------------------------------------------------------ */
/*  FOLLOW-UPS                                                        */
/* ------------------------------------------------------------------ */

export type FollowupKeyboard = "none" | "free_channel" | "plans";

export type FollowupRule = {
  key: string;
  /** Hours of silence (since the last message in either direction) before sending. */
  afterSilentHours: number;
  keyboard: FollowupKeyboard;
  /** Instruction for the model (English is fine; the output is Turkish). */
  goal: string;
  /** Used if the model is unavailable. Turkish. */
  fallback: string;
};

/**
 * Evaluated top to bottom; the first rule whose condition (followups.ts)
 * and timing match is used. Every key is sent at most once per lead.
 */
export const FOLLOWUP_RULES: Record<string, FollowupRule[]> = {
  CHECKOUT: [
    {
      key: "checkout_1",
      afterSilentHours: 3,
      keyboard: "plans",
      goal: "They opened the checkout but did not finish. Ask, without pressure, whether something went wrong with the payment or whether a question came up. Offer help.",
      fallback: "Selam! VIP ödeme sayfasını açtığını ama tamamlamadığını gördüm. Bir sorun mu çıktı, aklına takılan bir şey mi var? İstersen buradan yardımcı olayım.",
    },
    {
      key: "checkout_2",
      afterSilentHours: 48,
      keyboard: "plans",
      goal: "Last checkout reminder. One line. Make it clear there is no pressure and the free channel remains available.",
      fallback: "Sadece haber vereyim: VIP planları hâlâ istersen aşağıda. Acele yok — ücretsiz kanal senin için aynen devam ediyor.",
    },
  ],
  VIP_OFFERED: [
    {
      key: "offer_1",
      afterSilentHours: 24,
      keyboard: "none",
      goal: "They saw the VIP offer and went quiet. Ask if any question about the VIP was left unanswered. Reference something specific they said they want. Do not repeat the pitch.",
      fallback: "VIP ile ilgili cevaplayabileceğim bir sorun kaldı mı?",
    },
    {
      key: "offer_2",
      afterSilentHours: 72,
      keyboard: "plans",
      goal: "Final soft check-in about the VIP. Say it is fine if it is not the moment, and that they can call you whenever they want. After this we stop bringing it up.",
      fallback: "Konuyu son kez açıyorum, söz 🙂 VIP şimdilik sana göre değilse sorun yok. Planları görmek istediğinde yazman yeterli.",
    },
  ],
  FREE_INVITED: [
    {
      key: "free_1",
      afterSilentHours: 20,
      keyboard: "free_channel",
      goal: "They were invited to the free channel but have not joined. Remind them it is free and what they will find there. One short message.",
      fallback: "Ücretsiz kanala girebildin mi? Aşağıdaki düğmeye dokunman yeterli. Takip etmek için hiçbir ücret yok.",
    },
    {
      key: "free_2",
      afterSilentHours: 72,
      keyboard: "free_channel",
      goal: "Second and last reminder about the free channel. Keep it light.",
      fallback: "Ücretsiz kanal senin için açık kalmaya devam ediyor. Göz atmak istediğinde düğme burada.",
    },
  ],
  ENGAGED: [
    {
      key: "engaged_0",
      afterSilentHours: 5,
      keyboard: "none",
      goal: "They joined the free channel a few hours ago and never replied to the welcome. One short, friendly line: ask whether they saw the free tip in the channel and what they think. No VIP.",
      fallback: "Kanaldaki günün tahminine göz atabildin mi? Ne düşündün? 🙂",
    },
    {
      key: "engaged_1",
      afterSilentHours: 48,
      keyboard: "none",
      goal: "They joined the free channel and went quiet. Restart the conversation about FOOTBALL using their team/league from the profile, or ask what they thought of the free content. Do NOT mention the VIP.",
      fallback: "Kanaldaki içeriği şimdiye kadar nasıl buldun?",
    },
    {
      key: "engaged_2",
      afterSilentHours: 120,
      keyboard: "none",
      goal: "Light check-in. Ask which games of the week they are following. Do NOT mention the VIP.",
      fallback: "Bu hafta takip ettiğin bir maç var mı?",
    },
  ],
  DISCOVERY: [
    {
      key: "discovery_1",
      afterSilentHours: 20,
      keyboard: "none",
      goal: "They started the bot and stopped replying early. One friendly, very short nudge that continues the last question.",
      fallback: "Buralarda mısın? Söyle bakalım, hangi takımı tutuyorsun?",
    },
  ],
};

export const FOLLOWUPS = {
  maxPerLeadTotal: 6,
  maxSinceLastReply: 2,
  /** Local hours (Europe/Istanbul) in which follow-ups may be sent. */
  sendFromHour: 9,
  sendUntilHour: 22,
  timezone: "Europe/Istanbul",
  maxPerRun: 40,
  /** From the 2nd follow-up on, remind how to stop messages. */
  optOutHint: "\n\n(Benden mesaj almak istemiyorsan DUR yazman yeterli.)",
} as const;

/* ------------------------------------------------------------------ */
/*  LEARNING                                                          */
/* ------------------------------------------------------------------ */

export const LEARNING = {
  /** Closed conversations analysed per cron run. */
  maxAnalysesPerRun: 15,
  /** New analyses needed before the Sales Coach proposes a new playbook. */
  coachBatchSize: 10,
  /** The coach may add/modify/remove at most this many guidelines per version. */
  maxGuidelineChangesPerVersion: 3,
  maxGuidelines: 12,
  /** Experiments */
  defaultMinSamplePerVariant: 50,
  defaultMaxSamplePerVariant: 400,
  /** Days a lead must have existed before it counts in an experiment. */
  experimentMaturityDays: 3,
  significanceLevel: 0.05,
} as const;

/** Prompt slots experiments can target → stages where that slot is "live". */
export const EXPERIMENT_SLOTS: Record<string, Stage[]> = {
  opening: ["NEW", "DISCOVERY"],
  free_invite: ["DISCOVERY", "FREE_INVITED"],
  engagement: ["ENGAGED"],
  vip_transition: ["ENGAGED"],
  objection_handling: ["VIP_OFFERED", "CHECKOUT"],
};

export type ExperimentMetric = "reply" | "free_join" | "vip_offer" | "checkout" | "purchase";

/* ------------------------------------------------------------------ */
/*  META EVENTS                                                       */
/* ------------------------------------------------------------------ */

/**
 * What Meta receives, in funnel order:
 *   Contact               — tapped "Abrir no Telegram" on the landing page (browser pixel + server, de-duplicated)
 *   Lead                  — started the bot                                  (server)
 *   CompleteRegistration  — joined the free channel, verified by Telegram   (server)
 *   VipOfferShown         — custom event, first time the plans are shown     (server)
 *   InitiateCheckout      — opened a Whop checkout                           (server)
 *   Purchase              — Whop confirmed the first payment                 (server, with value + currency)
 *
 * action_source must be truthful (Meta's terms):
 *  - "website": happened on a web page (needs URL + browser user agent, which we store from the landing page).
 *  - "chat":    happened inside the Telegram conversation.
 * The click identifiers captured on the landing page (fbc / fbp / IP / user agent / external_id) are sent
 * with EVERY event, which is what lets Meta attribute a Telegram event back to the ad.
 */
export const META_EVENTS = {
  ctaClick: { name: "Contact", actionSource: "website", enabled: true },
  botStarted: { name: "Lead", actionSource: "chat", enabled: true },
  freeJoined: { name: "CompleteRegistration", actionSource: "chat", enabled: true },
  vipOfferShown: { name: "VipOfferShown", actionSource: "chat", enabled: true },
  checkoutStarted: { name: "InitiateCheckout", actionSource: "website", enabled: true },
  purchase: { name: "Purchase", actionSource: "website", enabled: true },
  /** Said "no" to the VIP → lets you EXCLUDE these people from VIP retargeting ads. */
  notInterested: { name: "NotInterested", actionSource: "chat", enabled: true },
  /** Wrote DUR, or was flagged (minor / gambling harm), or you switched selling off → exclude from EVERY ad set. The reason is never sent. */
  doNotTarget: { name: "DoNotTarget", actionSource: "chat", enabled: true },
  /** Subscription renewals are stored as revenue but not sent as Purchase by default. */
  sendRenewalsAsPurchase: false,
} as const;

/* ------------------------------------------------------------------ */
/*  DATA RETENTION + SUPPORT                                           */
/* ------------------------------------------------------------------ */

/** Free Supabase plan = 500 MB. Old chat texts and raw logs are deleted daily; everything learned is kept. */
export const RETENTION = { messageDays: 30, eventDays: 30 } as const;

export const SUPPORT = {
  /** An open ticket nobody touched for this long is released back to the AI. */
  autoReleaseHours: 12,
  /** Issue → solution pairs taught by the owner that are injected into the sales prompt. */
  maxKnowledgeEntries: 25,
} as const;
