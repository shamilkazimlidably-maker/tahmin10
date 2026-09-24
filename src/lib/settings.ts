import { z } from "zod";
import { BUSINESS } from "../config/business";
import { FOLLOWUPS, FOLLOWUP_RULES, FUNNEL, LEARNING, META_EVENTS, RETENTION, SIGNALS, SUPPORT } from "../config/funnel";
import { LANDING, LANDING_OPTIONAL_KEYS } from "../config/landing";
import { SAFE, SAFE_OPTIONAL_KEYS } from "../config/safe";
import { GATE, type GateSettings } from "../config/gate";
import { GUARD, type GuardRule, type GuardSettings } from "../config/guard";
import { THEME, isHex, type ThemeSettings } from "../config/theme";
import { COMMANDS, type CommandSettings } from "../config/commands";
import { INBOX, type InboxSettings } from "../config/inbox";
import { TEXTS } from "../config/texts";
import { INTEGRATION_OVERRIDES } from "./integrations";
import { lockedPromptPart, PROMPT_BLOCKS, PROMPT_TEXTS, salesAgentStaticPrompt, STAGE_INSTRUCTIONS, SUPPORT_KB, type KnowledgeEntry, type PromptBlockKey } from "../config/prompts";
import { findForbiddenClaims } from "../sales/guardrails";
import { db } from "./supabase";

/**
 * OWNER SETTINGS
 * --------------
 * The files in src/config are the DEFAULTS. Whatever the owner saves in the
 * admin panel (/admin) is stored in Supabase (`app_state`, key "settings")
 * and applied ON TOP of those defaults here, at runtime — no redeploy needed.
 *
 * Every request entry point calls `await loadSettings()`; the result is cached
 * for 20 seconds per server instance, so a change is live everywhere in < 30s.
 */

const clone = <T>(v: T): T => structuredClone(v);
type Dict<T = unknown> = Record<string, T>;

/* ------------------------------------------------------------------ */
/*  What may be changed, and within which limits                       */
/* ------------------------------------------------------------------ */

export const RULE_SPECS = {
  funnel: {
    instantWelcome: [0, 1],
    minRepliesBeforeFreeInvite: [0, 10],
    forceFreeInviteAfterReplies: [1, 20],
    minRepliesAfterJoinBeforeOffer: [0, 10],
    vipScoreThreshold: [0, 100],
    offerDueAfterEligibleTurns: [0, 10],
    maxProactiveOffers: [0, 5],
    offerCooldownHours: [1, 720],
    closeAsLostAfterSilentDays: [2, 60],
    historyMessages: [8, 60],
  },
  followups: { maxPerLeadTotal: [0, 12], maxSinceLastReply: [0, 4], sendFromHour: [0, 23], sendUntilHour: [1, 24], maxPerRun: [1, 200] },
  learning: { coachBatchSize: [3, 100], defaultMinSamplePerVariant: [10, 1000] },
  retention: { messageDays: [7, 365], eventDays: [7, 365] },
  support: { autoReleaseHours: [1, 72] },
} as const satisfies Dict<Dict<readonly [number, number]>>;

type RuleGroup = keyof typeof RULE_SPECS;
const RULE_TARGETS: Record<RuleGroup, Dict<number>> = {
  funnel: FUNNEL as unknown as Dict<number>,
  followups: FOLLOWUPS as unknown as Dict<number>,
  learning: LEARNING as unknown as Dict<number>,
  retention: RETENTION as unknown as Dict<number>,
  support: SUPPORT as unknown as Dict<number>,
};
const signalRows = SIGNALS as unknown as { key: string; weight: number; source: string; description: string }[];
const allFollowupRules = () => Object.values(FOLLOWUP_RULES).flat();

const str = (max: number) => z.string().trim().max(max);
const nstr = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v ? v : null));
const list = (max: number, n: number) => z.array(str(max).min(1)).max(n);
const count = z.number().int().min(0).max(100000);

const businessSchema = z.object({
  brand: str(40).min(1),
  minimumAge: z.number().int().min(18).max(25),
  freeChannel: z.object({ name: str(80).min(1), whatWePost: list(220, 8), postingFrequency: nstr(120), positioning: str(600) }),
  vip: z.object({
    name: str(60).min(1),
    delivery: str(300).min(1),
    benefits: list(240, 10).min(1),
    volume: nstr(300),
    coverage: nstr(400),
    marketTypes: nstr(600),
    combos: nstr(500),
    plansDifferOnlyInDuration: z.boolean(),
    refundPolicy: nstr(300),
    cancellation: nstr(400),
    trackRecord: z
      .object({
        periods: z
          .array(z.object({ label: str(60).min(1), total: count, won: count, lost: count, void: count, averageOdds: z.number().min(1).max(100), profitUnits: z.number().min(-10000).max(10000) }))
          .min(1)
          .max(12),
        scope: str(240),
        disclaimer: str(240).min(10),
      })
      .nullable(),
    testimonials: z.array(z.object({ author: str(60).min(1), text: str(600).min(1) })).max(6),
    activePromotion: nstr(300),
  }),
  plans: z
    .array(
      z.object({
        key: z.enum(["weekly", "monthly", "three_months"]),
        name: str(40).min(1),
        priceLabel: str(60).min(1),
        price: z.number().positive().max(100000),
        billingType: z.enum(["recurring", "one_time"]),
        billingLabel: str(220).min(1),
        bestFor: str(220),
      }),
    )
    .length(3),
  voiceExamples: list(220, 12),
  neverSay: list(320, 15),
});
type BusinessInput = z.infer<typeof businessSchema>;

/* ------------------------------------------------------------------ */
/*  Defaults snapshot (taken once, before any override is applied)     */
/* ------------------------------------------------------------------ */

const D = {
  business: clone(BUSINESS),
  blocks: { ...PROMPT_BLOCKS },
  stages: { ...STAGE_INSTRUCTIONS } as Dict<string>,
  rules: Object.fromEntries(
    (Object.keys(RULE_SPECS) as RuleGroup[]).map((g) => [g, Object.fromEntries(Object.keys(RULE_SPECS[g]).map((k) => [k, RULE_TARGETS[g][k]!]))]),
  ) as Record<RuleGroup, Dict<number>>,
  weights: Object.fromEntries(signalRows.map((s) => [s.key, s.weight])) as Dict<number>,
  followupRules: Object.fromEntries(allFollowupRules().map((r) => [r.key, { afterSilentHours: r.afterSilentHours, goal: r.goal, fallback: r.fallback }])),
};

const EVENT_KEYS = ["ctaClick", "botStarted", "freeJoined", "vipOfferShown", "checkoutStarted", "purchase", "notInterested", "doNotTarget"] as const;
type EventKey = (typeof EVENT_KEYS)[number];
const metaEvents = META_EVENTS as unknown as Record<EventKey, { name: string; actionSource: string; enabled: boolean }> & { sendRenewalsAsPurchase: boolean };
const D_EVENTS = Object.fromEntries(EVENT_KEYS.map((k) => [k, { name: metaEvents[k].name, enabled: true }])) as Record<EventKey, { name: string; enabled: boolean }>;
const D_TEXTS = { ...TEXTS } as Dict<string>;
const D_LANDING = { ...LANDING } as Dict<string>;
/** Landing fields that may be left empty (the line simply disappears). */
const LANDING_OPTIONAL = new Set<string>(LANDING_OPTIONAL_KEYS);
const D_SAFE = { ...SAFE } as Dict<string>;
const SAFE_OPTIONAL = new Set<string>(SAFE_OPTIONAL_KEYS);
const D_GATE: GateSettings = { ...GATE };
const D_PTEXTS = { ...PROMPT_TEXTS } as Dict<string>;
const D_GUARD: GuardSettings = JSON.parse(JSON.stringify(GUARD));
const D_THEME: ThemeSettings = { ...THEME };
const D_COMMANDS = { ...COMMANDS } as Dict<string>;
const D_INBOX: InboxSettings = { ...INBOX };

export type StoredIntegrations = {
  metaPixelId?: string; metaAccessToken?: string; metaTestEventCode?: string; supportUsername?: string;
  freeChannelUrl?: string; vipChannelUrl?: string; deepseekModel?: string; deepseekCoachModel?: string;
  events?: Partial<Record<EventKey, { name: string; enabled: boolean }>>; sendRenewalsAsPurchase?: boolean;
};

export type StoredSettings = {
  texts?: Dict<string>;
  landing?: Dict<string>;
  safe?: Dict<string>;
  gate?: Partial<GateSettings>;
  prompts_full?: Dict<string>;
  guard?: Partial<GuardSettings>;
  theme?: Partial<ThemeSettings>;
  commands?: Dict<string>;
  inbox?: Partial<InboxSettings>;
  integrations?: StoredIntegrations;
  business?: unknown;
  prompts?: { blocks?: Dict<string>; stages?: Dict<string> };
  rules?: { funnel?: Dict<number>; followups?: Dict<number>; learning?: Dict<number>; retention?: Dict<number>; support?: Dict<number>; weights?: Dict<number>; followupRules?: Dict<{ afterSilentHours: number; goal: string; fallback: string }> };
};
export type SettingsSection = keyof StoredSettings;

/* ------------------------------------------------------------------ */
/*  Apply                                                              */
/* ------------------------------------------------------------------ */

const num = (v: unknown, [min, max]: readonly [number, number]): number | undefined => {
  const n = Number(v);
  return v === null || v === undefined || v === "" || !Number.isFinite(n) ? undefined : Math.min(max, Math.max(min, n));
};
const text = (v: unknown, max: number, allowEmpty = false): string | undefined =>
  typeof v === "string" && v.length <= max && (allowEmpty || v.trim()) ? v : undefined;

function assignBusiness(data: BusinessInput): void {
  // Plan key / env var mapping is fixed by the code; everything the customer reads is editable.
  const plans = D.business.plans.map((p) => ({ ...p, ...(data.plans.find((x) => x.key === p.key) ?? {}) }));
  Object.assign(BUSINESS, { ...data, plans });
}

function applyStored(s: StoredSettings): void {
  Object.assign(BUSINESS, clone(D.business));
  if (s.business) {
    const parsed = businessSchema.safeParse(s.business);
    if (parsed.success) assignBusiness(parsed.data);
    else console.error("[settings] stored business info is invalid, using defaults:", parsed.error.issues[0]);
  }

  for (const k of Object.keys(D_TEXTS)) (TEXTS as Dict<string>)[k] = text(s.texts?.[k], 1500) ?? D_TEXTS[k]!;
  for (const k of Object.keys(D_LANDING)) (LANDING as Dict<string>)[k] = text(s.landing?.[k], 1200, LANDING_OPTIONAL.has(k)) ?? D_LANDING[k]!;
  for (const k of Object.keys(D_SAFE)) (SAFE as Dict<string>)[k] = text(s.safe?.[k], 3000, SAFE_OPTIONAL.has(k)) ?? D_SAFE[k]!;
  Object.assign(GATE, D_GATE, cleanGate(s.gate ?? {}));
  for (const k of Object.keys(D_PTEXTS)) (PROMPT_TEXTS as Dict<string>)[k] = text(s.prompts_full?.[k], 12000) ?? D_PTEXTS[k]!;
  Object.assign(GUARD, cleanGuard(s.guard ?? {}));
  Object.assign(THEME, cleanTheme(s.theme ?? {}));
  for (const k of Object.keys(D_COMMANDS)) (COMMANDS as Dict<string>)[k] = text(s.commands?.[k], 2000) ?? D_COMMANDS[k]!;
  Object.assign(INBOX, cleanInbox(s.inbox ?? {}));

  const it = s.integrations ?? {};
  const o = INTEGRATION_OVERRIDES;
  o.metaPixelId = it.metaPixelId || undefined;
  o.metaAccessToken = it.metaAccessToken || undefined;
  o.metaTestEventCode = typeof it.metaTestEventCode === "string" ? it.metaTestEventCode : undefined;
  o.supportUsername = it.supportUsername || undefined;
  o.freeChannelUrl = it.freeChannelUrl || undefined;
  o.vipChannelUrl = it.vipChannelUrl || undefined;
  o.deepseekModel = it.deepseekModel || undefined;
  o.deepseekCoachModel = it.deepseekCoachModel || undefined;
  for (const k of EVENT_KEYS) {
    metaEvents[k].name = it.events?.[k]?.name && EVENT_NAME.test(it.events[k]!.name) ? it.events[k]!.name : D_EVENTS[k].name;
    metaEvents[k].enabled = it.events?.[k]?.enabled !== false;
  }
  metaEvents.sendRenewalsAsPurchase = it.sendRenewalsAsPurchase === true;

  for (const k of Object.keys(D.blocks) as PromptBlockKey[]) PROMPT_BLOCKS[k] = text(s.prompts?.blocks?.[k], 8000, k === "extra") ?? D.blocks[k];
  for (const k of Object.keys(D.stages)) (STAGE_INSTRUCTIONS as Dict<string>)[k] = text(s.prompts?.stages?.[k], 2500) ?? D.stages[k]!;

  for (const g of Object.keys(RULE_SPECS) as RuleGroup[]) {
    for (const [k, range] of Object.entries(RULE_SPECS[g])) RULE_TARGETS[g][k] = num(s.rules?.[g]?.[k], range) ?? D.rules[g][k]!;
  }
  for (const row of signalRows) row.weight = num(s.rules?.weights?.[row.key], [-20, 20]) ?? D.weights[row.key]!;
  for (const rule of allFollowupRules()) {
    const o = s.rules?.followupRules?.[rule.key];
    const d = D.followupRules[rule.key]!;
    rule.afterSilentHours = num(o?.afterSilentHours, [1, 720]) ?? d.afterSilentHours;
    rule.goal = text(o?.goal, 700) ?? d.goal;
    rule.fallback = text(o?.fallback, 600) ?? d.fallback;
  }
}

/* ------------------------------------------------------------------ */
/*  Load / save                                                        */
/* ------------------------------------------------------------------ */

const EVENT_NAME = /^[A-Za-z][A-Za-z0-9_]{1,39}$/;
const TTL_MS = 20_000;
const KB_KEY = "support_kb";

function applyKnowledge(list: unknown): void {
  SUPPORT_KB.length = 0;
  if (!Array.isArray(list)) return;
  for (const e of list.slice(-SUPPORT.maxKnowledgeEntries) as Dict[]) {
    const issue = text(e?.issue, 300);
    const solution = text(e?.solution, 700);
    if (issue && solution) SUPPORT_KB.push({ id: String(e.id ?? SUPPORT_KB.length), issue: issue.trim(), solution: solution.trim(), created_at: typeof e.created_at === "string" ? e.created_at : undefined, ticket_id: typeof e.ticket_id === "number" ? e.ticket_id : undefined });
  }
}
let loadedAt = 0;

async function readStored(): Promise<StoredSettings> {
  const { data, error } = await db().from("app_state").select("value").eq("key", "settings").maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.value ?? {}) as StoredSettings;
}

/** Never throws: if the database is unreachable the bot keeps running with the last known (or default) settings. */
export async function loadSettings(force = false): Promise<void> {
  if (!force && Date.now() - loadedAt < TTL_MS) return;
  try {
    const { data, error } = await db().from("app_state").select("key, value").in("key", ["settings", KB_KEY]);
    if (error) throw new Error(error.message);
    applyStored((data?.find((r) => r.key === "settings")?.value ?? {}) as StoredSettings);
    applyKnowledge(data?.find((r) => r.key === KB_KEY)?.value);
    loadedAt = Date.now();
  } catch (error) {
    console.error("[settings] could not load, keeping current values:", (error as Error).message);
    loadedAt = Date.now() - TTL_MS / 2; // try again in ~10s
  }
}

const BLOCKING = new Set(["guaranteed_result", "risk_free", "easy_money", "certainty", "fake_scarcity", "chasing_losses"]);
function forbiddenIn(texts: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const t of texts) {
    if (!t) continue;
    const hits = findForbiddenClaims(t).filter((h) => BLOCKING.has(h));
    if (hits.length) out.push(`Bu metin yasak bir vaat içeriyor (garanti / risksiz / kolay para / sahte aciliyet / kaybı geri kazan): “${t.slice(0, 90)}”`);
  }
  return out;
}

export class SettingsError extends Error {
  constructor(public problems: string[]) {
    super(problems.join("\n"));
  }
}

const wordListStr = (v: unknown, d: string, max = 3000) => (typeof v === "string" ? v.replace(/\s*,\s*/g, ", ").trim().slice(0, max) : d);
const bool = (x: unknown, d: boolean) => (typeof x === "boolean" ? x : x === "true" ? true : x === "false" ? false : d);

/** Güvenlik filtresi ayarlarını temizler. */
function cleanGuard(v: Partial<GuardSettings>, strict = false): GuardSettings {
  const problems: string[] = [];
  const rules: GuardRule[] = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(v.rules) ? v.rules.slice(0, 80) : D_GUARD.rules) {
    const id = String(r?.id ?? "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40) || "custom";
    const label = String(r?.label ?? "").trim().slice(0, 60) || id;
    const kind = r?.kind === "regex" ? "regex" : "word";
    const value = String(r?.value ?? "").trim().slice(0, 400);
    if (!value) continue;
    if (kind === "regex") { try { new RegExp(value, "g"); } catch { problems.push(`“${label}” düzenli ifadesi geçersiz.`); continue; } }
    const key = `${kind}:${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push({ id, label, kind, value, enabled: bool(r?.enabled, true), weakNegation: bool(r?.weakNegation, false) });
  }
  let optOutPhrases = wordListStr(v.optOutPhrases, D_GUARD.optOutPhrases);
  for (const ph of optOutPhrases.split(",").map((x) => x.trim()).filter(Boolean)) { try { new RegExp(ph); } catch { problems.push(`“Mesaj istemiyor” kalıbı geçersiz: ${ph}`); optOutPhrases = D_GUARD.optOutPhrases; break; } }
  if (strict && problems.length) throw new SettingsError(problems);
  return {
    enabled: bool(v.enabled, D_GUARD.enabled), rules,
    negationAfter: wordListStr(v.negationAfter, D_GUARD.negationAfter), negationWeak: wordListStr(v.negationWeak, D_GUARD.negationWeak), negationBefore: wordListStr(v.negationBefore, D_GUARD.negationBefore),
    optOutWhole: wordListStr(v.optOutWhole, D_GUARD.optOutWhole), optOutPhrases,
    checkStats: bool(v.checkStats, D_GUARD.checkStats), resultWords: wordListStr(v.resultWords, D_GUARD.resultWords), promoWords: wordListStr(v.promoWords, D_GUARD.promoWords), checkLinks: bool(v.checkLinks, D_GUARD.checkLinks),
  };
}

function cleanInbox(v: Partial<InboxSettings>): InboxSettings {
  return {
    mode: v.mode === "ai" ? "ai" : "human",
    notifyTelegram: bool(v.notifyTelegram, D_INBOX.notifyTelegram),
    notifyCooldownMinutes: Math.max(0, Math.min(1440, Math.round(Number(v.notifyCooldownMinutes ?? D_INBOX.notifyCooldownMinutes)) || 0)),
    joinedMessage: typeof v.joinedMessage === "string" ? v.joinedMessage.trim().slice(0, 1000) : D_INBOX.joinedMessage,
    agentName: typeof v.agentName === "string" ? v.agentName.trim().slice(0, 60) : D_INBOX.agentName,
  };
}

/** Tasarım ayarlarını temizler. */
function cleanTheme(v: Partial<ThemeSettings>, strict = false): ThemeSettings {
  const problems: string[] = [];
  const out = { ...D_THEME } as Dict<unknown>;
  for (const k of Object.keys(D_THEME) as (keyof ThemeSettings)[]) {
    const d = D_THEME[k]; const x = (v as Dict<unknown>)[k];
    if (x === undefined || x === null) continue;
    if (typeof d === "boolean") out[k] = bool(x, d);
    else if (typeof d === "number") { const n = Number(x); out[k] = Number.isFinite(n) ? Math.max(0, Math.min(k === "lpMutedOpacity" ? 100 : 60, Math.round(n))) : d; }
    else if (k.endsWith("CustomCss")) out[k] = String(x).slice(0, 8000);
    else if (k === "lpFontDisplay") out[k] = ["condensed", "system", "serif", "rounded", "mono"].includes(String(x)) ? String(x) : d;
    else if (k === "lpFontBody") out[k] = ["system", "serif", "rounded", "mono"].includes(String(x)) ? String(x) : d;
    else if (k === "lpHeroLayout") out[k] = x === "stack" ? "stack" : "side";
    else { const c = String(x).trim().toLowerCase(); if (isHex(c)) out[k] = c; else problems.push(`Renk kodu #rrggbb biçiminde olmalı (${k}: “${String(x)}”).`); }
  }
  if (strict && problems.length) throw new SettingsError(problems);
  return out as unknown as ThemeSettings;
}

/** Ziyaretçi filtresi ayarlarını temizler; strict=true ise hatalı değerde SettingsError fırlatır. */
function cleanGate(v: Partial<GateSettings>, strict = false): GateSettings {
  const problems: string[] = [];
  const bool = (x: unknown, d: boolean) => (typeof x === "boolean" ? x : x === "true" ? true : x === "false" ? false : d);
  const countries = typeof v.allowedCountries === "string" ? v.allowedCountries.toUpperCase().replace(/\s+/g, "") : D_GATE.allowedCountries;
  if (countries && !/^[A-Z]{2}(,[A-Z]{2})*$/.test(countries)) problems.push("Ülke kodları iki harfli ve virgülle ayrılmış olmalı (ör. TR,AZ).");
  const unknownCountry = v.unknownCountry === "safe" ? "safe" : v.unknownCountry === "allow" ? "allow" : D_GATE.unknownCountry;
  const extra = typeof v.extraBotKeywords === "string" ? v.extraBotKeywords.slice(0, 500) : D_GATE.extraBotKeywords;
  if (strict && problems.length) throw new SettingsError(problems);
  return { enabled: bool(v.enabled, D_GATE.enabled), allowedCountries: problems.length ? D_GATE.allowedCountries : countries, unknownCountry, botsToSafe: bool(v.botsToSafe, D_GATE.botsToSafe), extraBotKeywords: extra, forceSafe: bool(v.forceSafe, D_GATE.forceSafe) };
}

/** Returns the cleaned value to store, or throws SettingsError with messages in Turkish. */
export function validateSection(section: SettingsSection, value: unknown): unknown {
  if (section === "business") {
    const parsed = businessSchema.safeParse(value);
    if (!parsed.success) throw new SettingsError(parsed.error.issues.slice(0, 6).map((i) => `Hatalı alan → ${i.path.join(" › ")}: ${i.message}`));
    const b = parsed.data;
    const problems = forbiddenIn([
      ...b.freeChannel.whatWePost, b.freeChannel.positioning, b.freeChannel.postingFrequency,
      ...b.vip.benefits, b.vip.volume, b.vip.coverage, b.vip.marketTypes, b.vip.combos, b.vip.delivery,
      ...b.plans.flatMap((p) => [p.name, p.priceLabel, p.billingLabel, p.bestFor]),
      ...b.voiceExamples, ...b.vip.testimonials.map((t) => t.text),
    ]);
    for (const p of b.vip.trackRecord?.periods ?? []) {
      if (p.won + p.lost + p.void !== p.total) problems.push(`Sonuç geçmişi “${p.label}”: kazanan + kaybeden + iptal = toplam olmalı (${p.won}+${p.lost}+${p.void} ≠ ${p.total}).`);
    }
    if (problems.length) throw new SettingsError(problems);
    return b;
  }
  if (section === "prompts") {
    const v = (value ?? {}) as NonNullable<StoredSettings["prompts"]>;
    const blocks: Dict<string> = {};
    const stages: Dict<string> = {};
    for (const k of Object.keys(D.blocks)) {
      const t = text(v.blocks?.[k], 8000, k === "extra");
      if (t === undefined && k !== "extra") throw new SettingsError([`“${k}” bölümü boş olamaz ve 8000 karakteri geçemez.`]);
      blocks[k] = t ?? "";
    }
    for (const k of Object.keys(D.stages)) {
      const t = text(v.stages?.[k], 2500);
      if (t === undefined) throw new SettingsError([`“${k}” aşama talimatı boş olamaz ve 2500 karakteri geçemez.`]);
      stages[k] = t;
    }
    return { blocks, stages };
  }
  if (section === "gate") return cleanGate((value ?? {}) as Partial<GateSettings>, true);
  if (section === "guard") return cleanGuard((value ?? {}) as Partial<GuardSettings>, true);
  if (section === "theme") return cleanTheme((value ?? {}) as Partial<ThemeSettings>, true);
  if (section === "inbox") return cleanInbox((value ?? {}) as Partial<InboxSettings>);
  if (section === "prompts_full") {
    const v = (value ?? {}) as Dict<unknown>;
    const out: Dict<string> = {};
    const problems: string[] = [];
    const must: Dict<string[]> = { analyst: ['"outcome"', '"loss_reason"', '"quality"', '"summary"'], coach: ['"playbook"', '"guidelines"', '"changes"', '"experiment_proposals"'], teach: ['"issue"', '"solution"'], followup: ['"messages"'], analytics: ['"oneriler"', '"ozet"'] };
    for (const k of Object.keys(D_PTEXTS)) {
      const t = text(v[k], 12000, false);
      if (t === null || t === undefined) { problems.push(`“${k}” boş olamaz; silmek yerine “Varsayılana dön” kullanın.`); continue; }
      for (const need of must[k] ?? []) if (!t.includes(need)) problems.push(`“${k}” metninde ${need} alanı kalmalı; yoksa sistem cevabı okuyamaz.`);
      out[k] = t;
    }
    if (problems.length) throw new SettingsError(problems);
    return out;
  }
  if (section === "commands") {
    const v = (value ?? {}) as Dict<unknown>;
    const out: Dict<string> = {};
    const problems: string[] = [];
    for (const k of Object.keys(D_COMMANDS)) {
      const t: string = text(v[k], 2000, false) ?? D_COMMANDS[k] ?? "";
      if (["plans", "channel", "stop"].includes(k) && !/^[a-z0-9_]{1,32}$/.test(t)) problems.push(`Komut adı yalnızca küçük harf, rakam ve _ içerebilir (${k}: “${t}”).`);
      out[k] = t;
    }
    if (new Set([out.plans, out.channel, out.stop, "start"]).size < 4) problems.push("Komut adları birbirinden farklı olmalı.");
    if (problems.length) throw new SettingsError(problems);
    return out;
  }
  if (section === "texts" || section === "landing" || section === "safe") {
    const defaults = section === "texts" ? D_TEXTS : section === "landing" ? D_LANDING : D_SAFE;
    const v = (value ?? {}) as Dict<string>;
    const out: Dict<string> = {};
    for (const k of Object.keys(defaults)) {
      const optional = (section === "landing" && LANDING_OPTIONAL.has(k)) || (section === "safe" && SAFE_OPTIONAL.has(k));
      const t = text(v[k], section === "texts" ? 1500 : section === "landing" ? 1200 : 3000, optional);
      if (t === undefined) throw new SettingsError([`“${k}” boş olamaz ve çok uzun olamaz.`]);
      if (k.startsWith("btn") && t.length > 40) throw new SettingsError([`“${k}”: düğme yazısı en fazla 40 karakter olabilir.`]);
      out[k] = t;
    }
    const problems = forbiddenIn(Object.values(out));
    if (problems.length) throw new SettingsError(problems);
    return out;
  }
  if (section === "integrations") {
    const v = (value ?? {}) as StoredIntegrations;
    const problems: string[] = [];
    const field = (raw: unknown, pattern: RegExp, label: string): string => {
      const t = typeof raw === "string" ? raw.trim() : "";
      if (t && !pattern.test(t)) problems.push(`${label} geçersiz görünüyor.`);
      return t;
    };
    const out: StoredIntegrations = {
      metaPixelId: field(v.metaPixelId, /^\d{5,25}$/, "Pixel ID (yalnızca rakam)"),
      metaAccessToken: field(v.metaAccessToken, /^(__CLEAR__|[A-Za-z0-9_|-]{30,600})$/, "Conversions API erişim anahtarı"),
      metaTestEventCode: field(v.metaTestEventCode, /^[A-Za-z0-9_-]{3,40}$/, "Test olay kodu"),
      supportUsername: field(v.supportUsername, /^@?[A-Za-z0-9_]{4,32}$/, "Destek kullanıcı adı"),
      freeChannelUrl: field(v.freeChannelUrl, /^https:\/\/t\.me\/\S{3,100}$/, "Ücretsiz kanal linki (https://t.me/… olmalı)"),
      vipChannelUrl: field(v.vipChannelUrl, /^https:\/\/t\.me\/\S{3,100}$/, "VIP kanal linki (https://t.me/… olmalı)"),
      deepseekModel: field(v.deepseekModel, /^[A-Za-z0-9._-]{3,60}$/, "Yapay zekâ modeli"),
      deepseekCoachModel: field(v.deepseekCoachModel, /^[A-Za-z0-9._-]{3,60}$/, "Koç modeli"),
      events: {},
      sendRenewalsAsPurchase: v.sendRenewalsAsPurchase === true,
    };
    for (const k of EVENT_KEYS) {
      const name = typeof v.events?.[k]?.name === "string" ? v.events[k]!.name.trim() : D_EVENTS[k].name;
      if (!EVENT_NAME.test(name)) problems.push(`Olay adı geçersiz: “${name}”. Yalnızca harf, rakam ve alt çizgi; harfle başlamalı.`);
      out.events![k] = { name, enabled: v.events?.[k]?.enabled !== false };
    }
    if (problems.length) throw new SettingsError(problems);
    return out;
  }
  // rules
  const v = (value ?? {}) as NonNullable<StoredSettings["rules"]>;
  const out: NonNullable<StoredSettings["rules"]> = { funnel: {}, followups: {}, learning: {}, retention: {}, support: {}, weights: {}, followupRules: {} };
  for (const g of Object.keys(RULE_SPECS) as RuleGroup[]) {
    for (const [k, range] of Object.entries(RULE_SPECS[g])) out[g]![k] = num(v[g]?.[k], range) ?? D.rules[g][k]!;
  }
  for (const row of signalRows) out.weights![row.key] = num(v.weights?.[row.key], [-20, 20]) ?? D.weights[row.key]!;
  for (const rule of allFollowupRules()) {
    const o = v.followupRules?.[rule.key];
    const d = D.followupRules[rule.key]!;
    out.followupRules![rule.key] = { afterSilentHours: num(o?.afterSilentHours, [1, 720]) ?? d.afterSilentHours, goal: text(o?.goal, 700) ?? d.goal, fallback: text(o?.fallback, 600) ?? d.fallback };
  }
  const problems = forbiddenIn(Object.values(out.followupRules!).map((r) => r.fallback));
  if (out.followups!.sendFromHour! >= out.followups!.sendUntilHour!) problems.push("Takip mesajı saatleri: başlangıç saati bitiş saatinden küçük olmalı.");
  if (out.funnel!.forceFreeInviteAfterReplies! < out.funnel!.minRepliesBeforeFreeInvite!) problems.push("“Daveti zorunlu yap” değeri, “davet için en az cevap” değerinden küçük olamaz.");
  if (problems.length) throw new SettingsError(problems);
  return out;
}

async function writeStored(stored: StoredSettings): Promise<void> {
  const { error } = await db().from("app_state").upsert({ key: "settings", value: stored, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
  applyStored(stored);
  loadedAt = Date.now();
}

export async function saveSection(section: SettingsSection, value: unknown): Promise<void> {
  const clean = validateSection(section, value);
  const stored = await readStored();
  if (section === "integrations") {
    // The token is never sent back to the browser: empty = keep the stored one, "__CLEAR__" = remove it.
    const next = clean as StoredIntegrations;
    if (next.metaAccessToken === "__CLEAR__") next.metaAccessToken = "";
    else if (!next.metaAccessToken) next.metaAccessToken = stored.integrations?.metaAccessToken ?? "";
  }
  await writeStored({ ...stored, [section]: clean });
}

export async function resetSection(section: SettingsSection): Promise<void> {
  const stored = await readStored();
  delete stored[section];
  await writeStored(stored);
}

/* ------------------------------------------------------------------ */
/*  Everything the admin panel needs to draw its forms                 */
/* ------------------------------------------------------------------ */

export function settingsView() {
  const live = {
    business: clone(BUSINESS),
    prompts: { blocks: { ...PROMPT_BLOCKS }, stages: { ...STAGE_INSTRUCTIONS } },
    rules: {
      ...(Object.fromEntries((Object.keys(RULE_SPECS) as RuleGroup[]).map((g) => [g, Object.fromEntries(Object.keys(RULE_SPECS[g]).map((k) => [k, RULE_TARGETS[g][k]]))])) as Record<RuleGroup, Dict<number>>),
      weights: Object.fromEntries(signalRows.map((s) => [s.key, s.weight])),
      followupRules: Object.fromEntries(allFollowupRules().map((r) => [r.key, { afterSilentHours: r.afterSilentHours, goal: r.goal, fallback: r.fallback }])),
    },
  };
  return {
    ...live,
    defaults: { texts: D_TEXTS, landing: D_LANDING, safe: D_SAFE, gate: D_GATE, prompts_full: D_PTEXTS, guard: D_GUARD, theme: D_THEME, commands: D_COMMANDS, inbox: D_INBOX, business: D.business, prompts: { blocks: D.blocks, stages: D.stages }, rules: { ...D.rules, weights: D.weights, followupRules: D.followupRules } },
    specs: RULE_SPECS,
    signals: signalRows.map((s) => ({ key: s.key, source: s.source, description: s.description })),
    followupBuckets: Object.fromEntries(Object.entries(FOLLOWUP_RULES).map(([bucket, rules]) => [bucket, rules.map((r) => ({ key: r.key, keyboard: r.keyboard }))])),
    texts: { ...TEXTS } as Dict<string>,
    landing: { ...LANDING } as Dict<string>,
    safe: { ...SAFE } as Dict<string>,
    gate: { ...GATE },
    prompts_full: { ...PROMPT_TEXTS } as Dict<string>,
    guard: JSON.parse(JSON.stringify(GUARD)) as GuardSettings,
    theme: { ...THEME },
    commands: { ...COMMANDS } as Dict<string>,
    inbox: { ...INBOX },
    integrations: {
      metaPixelId: INTEGRATION_OVERRIDES.metaPixelId ?? "",
      metaAccessToken: "", // never leaves the server
      metaTestEventCode: INTEGRATION_OVERRIDES.metaTestEventCode ?? "",
      supportUsername: INTEGRATION_OVERRIDES.supportUsername ?? "",
      freeChannelUrl: INTEGRATION_OVERRIDES.freeChannelUrl ?? "",
      vipChannelUrl: INTEGRATION_OVERRIDES.vipChannelUrl ?? "",
      deepseekModel: INTEGRATION_OVERRIDES.deepseekModel ?? "",
      deepseekCoachModel: INTEGRATION_OVERRIDES.deepseekCoachModel ?? "",
      events: Object.fromEntries(EVENT_KEYS.map((k) => [k, { name: metaEvents[k].name, enabled: metaEvents[k].enabled }])),
      sendRenewalsAsPurchase: metaEvents.sendRenewalsAsPurchase,
    },
    integrationsInfo: {
      tokenInPanel: INTEGRATION_OVERRIDES.metaAccessToken ? `…${INTEGRATION_OVERRIDES.metaAccessToken.slice(-4)}` : null,
      env: {
        pixel: Boolean(process.env.META_PIXEL_ID?.trim()), token: Boolean(process.env.META_ACCESS_TOKEN?.trim()), testCode: process.env.META_TEST_EVENT_CODE?.trim() || null,
        support: process.env.SUPPORT_USERNAME?.trim() || null, model: process.env.DEEPSEEK_MODEL?.trim() || "deepseek-flash", coachModel: process.env.DEEPSEEK_COACH_MODEL?.trim() || null,
        freeUrl: process.env.TELEGRAM_FREE_CHANNEL_URL?.trim() || null, vipUrl: process.env.TELEGRAM_VIP_CHANNEL_URL?.trim() || null,
      },
      eventDefaults: D_EVENTS,
      actionSources: Object.fromEntries(EVENT_KEYS.map((k) => [k, metaEvents[k].actionSource])),
    },
    knowledge: SUPPORT_KB.map((k) => ({ ...k })),
    lockedPrompt: lockedPromptPart(),
    fullPrompt: salesAgentStaticPrompt(),
  };
}

/* ------------------------------------------------------------------ */
/*  Bot knowledge: issue → solution pairs taught by the owner          */
/* ------------------------------------------------------------------ */

/** Full replace (admin panel). Entries with an empty issue or solution are dropped. */
export async function saveKnowledge(entries: unknown): Promise<void> {
  const clean: KnowledgeEntry[] = [];
  for (const e of (Array.isArray(entries) ? entries : []) as Dict[]) {
    const issue = text(e?.issue, 300)?.trim();
    const solution = text(e?.solution, 700)?.trim();
    if (!issue || !solution) continue;
    clean.push({ id: String(e.id ?? `k${Date.now()}${clean.length}`), issue, solution, created_at: typeof e.created_at === "string" ? e.created_at : new Date().toISOString(), ...(typeof e.ticket_id === "number" ? { ticket_id: e.ticket_id } : {}) });
  }
  if (clean.length > SUPPORT.maxKnowledgeEntries) throw new SettingsError([`En fazla ${SUPPORT.maxKnowledgeEntries} kayıt tutulabilir (bot her cevapta hepsini okur). Eskileri silin.`]);
  const problems = forbiddenIn(clean.map((k) => k.solution));
  if (problems.length) throw new SettingsError(problems);
  const { error } = await db().from("app_state").upsert({ key: KB_KEY, value: clean, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
  applyKnowledge(clean);
}

/** Append one entry (Telegram → "Teach the AI"). The oldest entry makes room when the list is full. */
export async function addKnowledge(entry: { issue: string; solution: string; ticket_id?: number }): Promise<void> {
  const { data, error } = await db().from("app_state").select("value").eq("key", KB_KEY).maybeSingle();
  if (error) throw new Error(error.message);
  const current = (Array.isArray(data?.value) ? data.value : []) as Dict[];
  await saveKnowledge([...current, { ...entry, id: `k${Date.now()}`, created_at: new Date().toISOString() }].slice(-SUPPORT.maxKnowledgeEntries));
}
