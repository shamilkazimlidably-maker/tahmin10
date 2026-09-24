import { z } from "zod";
import { deepseekJson, type ChatMessage } from "../lib/deepseek";
import type { Lead, Profile, StoredMessage } from "../lib/leads";
import { FUNNEL, type Stage } from "../config/funnel";
import { PROMPT_TEXTS, STAGE_INSTRUCTIONS, salesAgentStaticPrompt } from "../config/prompts";
import { renderPlaybook, type Playbook } from "../learning/playbook";
import type { Assignment } from "../learning/experiments";
import { TEXTS } from "../config/texts";
import { findForbiddenClaims, ensureResultsDisclaimer } from "./guardrails";
import { hoursSince } from "../lib/util";

/* ------------------------------------------------------------------ */
/*  Output contract                                                   */
/* ------------------------------------------------------------------ */

const NEXT_ACTIONS = ["none", "invite_free", "offer_vip", "show_plans", "handoff_human", "stop_selling"] as const;
export type NextAction = (typeof NEXT_ACTIONS)[number];

const stringList = z.array(z.string()).catch([]);

const outputSchema = z.object({
  messages: z
    .array(z.string())
    .catch([])
    .transform((list) => list.map((m) => m.trim()).filter(Boolean).slice(0, 2)),
  intent: z.string().catch("neutral"),
  next_action: z.enum(NEXT_ACTIONS).catch("none"),
  signals: z
    .record(z.string(), z.object({ value: z.coerce.number().catch(0), evidence: z.string().catch("") }))
    .catch({}),
  objection: z.enum(["price", "trust", "value", "timing", "results", "other"]).nullable().catch(null),
  profile_update: z
    .object({
      favorite_team: z.string().nullable().catch(null),
      leagues: stringList,
      prediction_usage: z.string().nullable().catch(null),
      wants: stringList,
      pain_points: stringList,
      style: z.string().nullable().catch(null),
      notes: z.string().nullable().catch(null),
    })
    .partial()
    .catch({}),
  risk_flag: z.enum(["underage", "gambling_harm"]).nullable().catch(null),
});

export type AgentOutput = z.infer<typeof outputSchema> & { guardrailHits: string[] };

/* ------------------------------------------------------------------ */
/*  Permissions the backend grants for THIS turn                       */
/* ------------------------------------------------------------------ */

export type Permissions = {
  inviteAllowed: boolean;
  inviteDue: boolean;
  offerAllowed: boolean;
  offerDue: boolean;
  plansAllowed: boolean;
};

export function stageOf(lead: Lead): Stage {
  if (lead.vip_active) return "PAID";
  if (lead.stage === "NOT_INTERESTED") return "NOT_INTERESTED";
  if (lead.checkout_started) return "CHECKOUT";
  if (lead.vip_offer_count > 0) return "VIP_OFFERED";
  if (lead.free_channel_joined) return "ENGAGED";
  if (lead.free_channel_invited) return "FREE_INVITED";
  if (lead.user_turns > 0) return "DISCOVERY";
  return "NEW";
}

export function permissionsFor(lead: Lead): Permissions {
  const blockedFromSales = lead.do_not_sell || lead.vip_active;
  const notInterested = lead.stage === "NOT_INTERESTED";

  const inviteAllowed = !lead.do_not_sell && !lead.free_channel_joined && lead.pre_free_turns >= FUNNEL.minRepliesBeforeFreeInvite;
  const inviteDue = inviteAllowed && !lead.free_channel_invited && lead.pre_free_turns >= FUNNEL.forceFreeInviteAfterReplies;

  const cooledDown = hoursSince(lead.vip_offer_last_at) >= FUNNEL.offerCooldownHours;
  const offerAllowed =
    !blockedFromSales &&
    !notInterested &&
    lead.free_channel_joined &&
    lead.post_free_turns >= FUNNEL.minRepliesAfterJoinBeforeOffer &&
    lead.score >= FUNNEL.vipScoreThreshold &&
    lead.vip_offer_count < FUNNEL.maxProactiveOffers &&
    cooledDown;

  return {
    inviteAllowed,
    inviteDue,
    offerAllowed,
    offerDue: offerAllowed && lead.eligible_turns >= FUNNEL.offerDueAfterEligibleTurns,
    plansAllowed: !blockedFromSales && FUNNEL.alwaysAnswerDirectBuyingQuestions,
  };
}

/* ------------------------------------------------------------------ */
/*  Prompt assembly                                                   */
/* ------------------------------------------------------------------ */

const yes = (b: boolean) => (b ? "EVET" : "HAYIR");

function renderState(lead: Lead, stage: Stage, p: Permissions): string {
  const now = new Intl.DateTimeFormat("tr-TR", { dateStyle: "full", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(new Date());
  return [
    "# DURUM (sistem belirledi — uy)",
    `Şu an (Türkiye): ${now}`,
    `İlk adı: ${lead.first_name ?? "bilinmiyor"}`,
    `Ücretsiz kanalda mı: ${yes(lead.free_channel_joined)}`,
    `Kanal daveti gönderildi mi: ${yes(lead.free_channel_invited)}`,
    `Şimdi "invite_free" kullanabilir misin: ${yes(p.inviteAllowed || (lead.free_channel_invited && !lead.free_channel_joined))}${
      p.inviteDue ? " — DAVETİ BU MESAJDA, doğal biçimde yap." : ""
    }`,
    `Şimdi "offer_vip" (kendi girişimin) kullanabilir misin: ${yes(p.offerAllowed)}${
      p.offerDue ? " — iyi bir an: kişi az önce bunu uygunsuz kılacak bir şey söylemediyse VIP köprüsünü bu mesajda kur." : ""
    }`,
    `Kişi VIP/fiyat/nasıl abone olunur diye SORARSA "show_plans" kullanabilir misin: ${yes(p.plansAllowed)}`,
    `VIP kaç kez anlatıldı: ${lead.vip_offer_count}${lead.vip_offer_last_at ? `, sonuncusu ${Math.round(hoursSince(lead.vip_offer_last_at))} saat önce` : ""}`,
    `Ödeme sayfasını açtı mı: ${yes(lead.checkout_started)}${lead.last_checkout_plan ? ` (plan: ${lead.last_checkout_plan})` : ""}`,
    `Aktif VIP müşterisi mi: ${yes(lead.vip_active)}`,
    lead.do_not_sell ? `⚠️ Bu kişiye SATIŞ YAPMA (${lead.do_not_sell_reason}). Yalnızca nazik ve özenli ol.` : "",
    "",
    STAGE_INSTRUCTIONS[stage],
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function renderProfile(profile: Profile | null): string {
  if (!profile) return "# PROFİL\n(henüz bilgi yok)";
  const parts = [
    profile.favorite_team && `Takım: ${profile.favorite_team}`,
    profile.leagues?.length && `Ligler: ${profile.leagues.join(", ")}`,
    profile.prediction_usage && `Tahminleri nasıl kullanıyor: ${profile.prediction_usage}`,
    profile.wants?.length && `Ne arıyor: ${profile.wants.join("; ")}`,
    profile.pain_points?.length && `Dertleri: ${profile.pain_points.join("; ")}`,
    profile.objections?.length && `Daha önce dile getirdiği itirazlar: ${profile.objections.join(", ")}`,
    profile.style && `Yazma tarzı: ${profile.style}`,
    profile.notes && `Notlar: ${profile.notes}`,
  ].filter(Boolean);
  return `# PROFİL (bu kişinin hafızası — kullan, aynı soruları tekrar sorma)\n${parts.length ? parts.join("\n") : "(henüz bilgi yok)"}`;
}

/** Stored history → chat messages. System events become bracketed user-side notes; same-role neighbours are merged. */
function toChatHistory(history: StoredMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of history) {
    const role: "user" | "assistant" = m.role === "assistant" ? "assistant" : "user";
    const content = m.role === "event" ? `[SİSTEM OLAYI — kişinin sözü değil] ${m.content}` : m.content;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += `\n${content}`;
    else out.push({ role, content });
  }
  if (out[0]?.role === "assistant") out.unshift({ role: "user", content: "[SİSTEM OLAYI — kişinin sözü değil] (konuşmanın başı atlandı)" });
  return out;
}

export type AgentInput = {
  lead: Lead;
  profile: Profile | null;
  history: StoredMessage[];
  playbook: Playbook;
  experiments: Assignment[];
  permissions: Permissions;
  stage: Stage;
  /** Extra instruction for system-triggered turns and follow-ups (Turkish or English). */
  directive?: string;
  followupMode?: boolean;
};

function buildMessages(input: AgentInput, correction?: string): ChatMessage[] {
  const dynamic = [
    renderPlaybook(input.playbook, input.stage),
    input.experiments.length
      ? "# AKTİF A/B TESTİ (durum uyduğunda uygula)\n" + input.experiments.map((e) => `- [${e.slot}] ${e.instruction}`).join("\n")
      : "",
    renderProfile(input.profile),
    renderState(input.lead, input.stage, input.permissions),
    input.followupMode ? PROMPT_TEXTS.followup : "",
    input.directive ? `# BU MESAJ İÇİN TALİMAT\n${input.directive}` : "",
    correction ? `# ZORUNLU DÜZELTME\n${correction}` : "",
    "Yalnızca json nesnesiyle cevap ver.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const history = toChatHistory(input.history);
  if (!history.length || history[history.length - 1]!.role !== "user") {
    history.push({ role: "user", content: "[SİSTEM OLAYI — kişinin sözü değil] Talimata göre bir sonraki mesajı yaz." });
  }

  return [
    // Static block first → identical prefix on every call → DeepSeek prompt-cache hits.
    { role: "system", content: salesAgentStaticPrompt() },
    { role: "system", content: dynamic },
    ...history,
  ];
}

/* ------------------------------------------------------------------ */
/*  Run                                                               */
/* ------------------------------------------------------------------ */

export async function runSalesAgent(input: AgentInput): Promise<AgentOutput> {
  let correction: string | undefined;
  let hits: string[] = [];

  for (let attempt = 0; attempt < 2; attempt++) {
    const { json } = await deepseekJson({
      messages: buildMessages(input, correction),
      temperature: input.followupMode ? 0.8 : 0.7,
      maxTokens: 1800,
      thinking: false,
      timeoutMs: 40_000,
      retries: 1,
      label: "sales-agent",
    });

    const parsed = outputSchema.parse(json ?? {});
    // Some models answer {"reply": "..."} despite instructions — salvage it.
    if (!parsed.messages.length) {
      const reply = (json as { reply?: unknown } | null)?.reply;
      if (typeof reply === "string" && reply.trim()) parsed.messages = [reply.trim()];
    }
    if (!parsed.messages.length) {
      correction = '"messages" alanı boş geldi. Kişiye cevabı "messages" içine yaz.';
      continue;
    }
    parsed.messages = parsed.messages.map((m) => (m.length > 600 ? m.slice(0, 597) + "…" : m));

    hits = findForbiddenClaims(parsed.messages.join("\n"));
    if (!hits.length) return { ...parsed, messages: ensureResultsDisclaimer(parsed.messages), guardrailHits: [] };

    correction = `Önceki cevabın kuralları ihlal etti (${hits.join(", ")}): "${parsed.messages.join(" ")}". Aynı şeyi vaat etmeden, uydurma sayı kullanmadan, aciliyet yaratmadan ve link yazmadan yeniden yaz.`;
    if (attempt === 1) {
      // Still unsafe after a correction → send something harmless and flag it for the owner.
      return { ...parsed, messages: [TEXTS.safeFallback], next_action: "handoff_human", guardrailHits: hits };
    }
  }
  return {
    messages: [TEXTS.safeFallback],
    intent: "neutral",
    next_action: "none",
    signals: {},
    objection: null,
    profile_update: {},
    risk_flag: null,
    guardrailHits: hits,
  };
}
