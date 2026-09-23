import { BUSINESS } from "../config/business";
import { deepseekJson } from "./deepseek";
import { getEnv } from "./env";
import { INTEGRATION_OVERRIDES } from "./integrations";
import { db } from "./supabase";

/**
 * ANALYTICS for the admin panel (→ Analiz).
 * Sources that are never auto-deleted: `daily_stats` (tiny daily funnel snapshot), `payments`, `ad_spend`,
 * `conversation_analyses`. So the numbers stay correct after chat texts, logs or even leads are deleted.
 * All dates are calendar days in Istanbul time.
 */

const TZ = "Europe/Istanbul";
const DAY = 86_400_000;
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
export const spDate = (d: Date | string) => dayFmt.format(typeof d === "string" ? new Date(d) : d);
const addDays = (day: string, n: number) => new Date(new Date(`${day}T12:00:00Z`).getTime() + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / DAY);
const monthOf = (day: string) => day.slice(0, 7);
const round2 = (n: number) => Math.round(n * 100) / 100;
const ratio = (a: number, b: number): number | null => (b > 0 ? round2(a / b) : null);

export type DailyRow = { day: string; campaign: string; clicks: number; started: number; replied: number; joined_free: number; saw_plans: number; checkouts: number; customers: number; revenue: number };
export type SpendRow = { id: number; day: string; campaign: string; amount: number; note: string | null; batch: string };
export type PaymentRow = {
  whop_payment_id: string; lead_id: string | null; whop_membership_id: string | null; plan_key: string | null; amount: number; status: string; is_first: boolean; created_at: string; refunded_at: string | null;
  leads?: { first_name: string | null; username: string | null; vip_active: boolean; campaign: string | null } | null;
};

const FUNNEL_KEYS = ["clicks", "started", "replied", "joined_free", "saw_plans", "checkouts", "customers"] as const;
type FunnelKey = (typeof FUNNEL_KEYS)[number];
type Sum = Record<FunnelKey, number> & { revenue: number; spend: number };
const emptySum = (): Sum => ({ clicks: 0, started: 0, replied: 0, joined_free: 0, saw_plans: 0, checkouts: 0, customers: 0, revenue: 0, spend: 0 });

/** How long one payment keeps the subscription alive (days). Used for "active", MRR and retention. */
const COVER_DAYS: Record<string, number> = { weekly: 7, monthly: 31, three_months: 92 };
const monthlyValue = (plan: string | null): number => {
  const p = BUSINESS.plans.find((x) => x.key === plan);
  if (!p) return 0;
  return plan === "weekly" ? p.price * 4.33 : plan === "three_months" ? p.price / 3 : p.price;
};

function unitEconomics(s: Sum, cashRevenue: number) {
  return {
    costPerClick: ratio(s.spend, s.clicks), costPerLead: ratio(s.spend, s.started), costPerRegistration: ratio(s.spend, s.joined_free),
    costPerCheckout: ratio(s.spend, s.checkouts), cac: ratio(s.spend, s.customers),
    roasCohort: ratio(s.revenue, s.spend), roasCash: ratio(cashRevenue, s.spend), revenuePerCustomer: ratio(s.revenue, s.customers),
    clickToLead: ratio(s.started * 100, s.clicks), leadToRegistration: ratio(s.joined_free * 100, s.started), registrationToCustomer: ratio(s.customers * 100, s.joined_free), leadToCustomer: ratio(s.customers * 100, s.started),
  };
}

/** Pure function (unit-tested): rows in → everything the dashboard draws. */
export function computeAnalytics(input: { from: string; to: string; today: string; daily: DailyRow[]; spend: SpendRow[]; payments: PaymentRow[] }) {
  const { from, to, today } = input;
  const length = daysBetween(from, to) + 1;
  const prevFrom = addDays(from, -length);
  const prevTo = addDays(from, -1);
  const inRange = (day: string, a: string, b: string) => day >= a && day <= b;

  /* ---- funnel by arrival day (cohorts) + spend ---- */
  const byDay = new Map<string, Sum>();
  const byCampaign = new Map<string, Sum>();
  const total = emptySum();
  const previous = emptySum();
  const bump = (target: Sum, row: Partial<Sum>) => { for (const k of Object.keys(row) as (keyof Sum)[]) target[k] += Number(row[k] ?? 0); };
  const get = <K>(map: Map<K, Sum>, key: K) => map.get(key) ?? (map.set(key, emptySum()), map.get(key)!);

  for (const r of input.daily) {
    const row: Partial<Sum> = { clicks: r.clicks, started: r.started, replied: r.replied, joined_free: r.joined_free, saw_plans: r.saw_plans, checkouts: r.checkouts, customers: r.customers, revenue: Number(r.revenue) };
    if (inRange(r.day, from, to)) { bump(total, row); bump(get(byDay, r.day), row); bump(get(byCampaign, r.campaign || ""), row); }
    else if (inRange(r.day, prevFrom, prevTo)) bump(previous, row);
  }
  for (const s of input.spend) {
    const row = { spend: Number(s.amount) };
    if (inRange(s.day, from, to)) { bump(total, row); bump(get(byDay, s.day), row); bump(get(byCampaign, s.campaign || ""), row); }
    else if (inRange(s.day, prevFrom, prevTo)) bump(previous, row);
  }

  /* ---- money by payment day (cash) ---- */
  const paid = input.payments.map((p) => ({ ...p, amount: Number(p.amount), day: spDate(p.created_at) }));
  const cashIn = (a: string, b: string) => round2(paid.filter((p) => p.status !== "refunded" && inRange(p.day, a, b)).reduce((t, p) => t + p.amount, 0));
  const cash = cashIn(from, to);
  const cashPrev = cashIn(prevFrom, prevTo);

  // series: daily up to 62 days, otherwise weekly buckets
  const weekly = length > 62;
  const bucketOf = (day: string) => (weekly ? addDays(from, Math.floor(daysBetween(from, day) / 7) * 7) : day);
  const series = new Map<string, Sum & { cash: number }>();
  for (let i = 0; i < length; i++) { const b = bucketOf(addDays(from, i)); if (!series.has(b)) series.set(b, { ...emptySum(), cash: 0 }); }
  for (const [day, s] of byDay) bump(series.get(bucketOf(day))!, s);
  for (const p of paid) if (p.status !== "refunded" && inRange(p.day, from, to)) series.get(bucketOf(p.day))!.cash += p.amount;

  /* ---- customers: one key per subscription / person ---- */
  type Customer = { key: string; name: string; username: string | null; campaign: string | null; total: number; count: number; first: string; last: string; plan: string | null; activeUntil: string; vip: boolean; periods: [string, string][] };
  const customers = new Map<string, Customer>();
  for (const p of [...paid].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (p.status === "refunded") continue;
    const key = p.lead_id ?? p.whop_membership_id ?? p.whop_payment_id;
    const until = addDays(p.day, COVER_DAYS[p.plan_key ?? ""] ?? 31);
    const c = customers.get(key) ?? { key, name: p.leads?.first_name ?? "(silinmiş kişi)", username: p.leads?.username ?? null, campaign: p.leads?.campaign ?? null, total: 0, count: 0, first: p.day, last: p.day, plan: p.plan_key, activeUntil: until, vip: Boolean(p.leads?.vip_active), periods: [] };
    c.total = round2(c.total + p.amount); c.count++; c.last = p.day; c.plan = p.plan_key ?? c.plan;
    if (until > c.activeUntil) c.activeUntil = until;
    c.periods.push([p.day, until]);
    customers.set(key, c);
  }
  const list = [...customers.values()];
  const activeOn = (c: Customer, a: string, b: string) => c.periods.some(([s, e]) => s <= b && e >= a);
  const activeNow = list.filter((c) => c.activeUntil >= addDays(today, -3)); // 3 days of grace for late renewals

  /* ---- last 12 months ---- */
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) { const d = new Date(`${today.slice(0, 7)}-15T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - i); months.push(d.toISOString().slice(0, 7)); }
  const monthEnd = (m: string) => { const d = new Date(`${m}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); return addDays(d.toISOString().slice(0, 10), -1); };
  const spendByMonth = new Map<string, number>();
  for (const s of input.spend) spendByMonth.set(monthOf(s.day), (spendByMonth.get(monthOf(s.day)) ?? 0) + Number(s.amount));
  const monthly = months.map((m) => {
    const rows = paid.filter((p) => monthOf(p.day) === m);
    const ok = rows.filter((p) => p.status !== "refunded");
    const newCustomers = list.filter((c) => monthOf(c.first) === m).length;
    const active = list.filter((c) => activeOn(c, `${m}-01`, monthEnd(m))).length;
    const before = list.filter((c) => c.first < `${m}-01` && activeOn(c, addDays(`${m}-01`, -31), addDays(`${m}-01`, -1))).length;
    const kept = list.filter((c) => c.first < `${m}-01` && activeOn(c, addDays(`${m}-01`, -31), addDays(`${m}-01`, -1)) && activeOn(c, `${m}-01`, monthEnd(m))).length;
    return {
      month: m, newRevenue: round2(ok.filter((p) => p.is_first).reduce((t, p) => t + p.amount, 0)), renewalRevenue: round2(ok.filter((p) => !p.is_first).reduce((t, p) => t + p.amount, 0)),
      refunds: round2(rows.filter((p) => p.status === "refunded").reduce((t, p) => t + p.amount, 0)), newCustomers, activeCustomers: active,
      churnRate: m <= monthOf(today) && before > 0 ? round2(((before - kept) / before) * 100) : null, spend: round2(spendByMonth.get(m) ?? 0),
    };
  });

  /* ---- retention: of the people who FIRST paid in month X, how many were still subscribed N months later ---- */
  const retention = months.slice(-8).map((m) => {
    const cohort = list.filter((c) => monthOf(c.first) === m);
    const cells: (number | null)[] = [];
    for (let n = 0; n <= 6; n++) {
      const d = new Date(`${m}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n);
      const mm = d.toISOString().slice(0, 7);
      cells.push(mm > monthOf(today) || !cohort.length ? null : Math.round((cohort.filter((c) => activeOn(c, `${mm}-01`, monthEnd(mm))).length / cohort.length) * 100));
    }
    return { month: m, size: cohort.length, cells };
  }).filter((r) => r.size > 0);

  const planMix = BUSINESS.plans.map((p) => ({ plan: p.key, name: p.name, firstPurchases: paid.filter((x) => x.is_first && x.status !== "refunded" && x.plan_key === p.key).length, revenue: round2(paid.filter((x) => x.status !== "refunded" && x.plan_key === p.key).reduce((t, x) => t + x.amount, 0)), activeNow: activeNow.filter((c) => c.plan === p.key).length }));
  const lifetimeRevenue = round2(list.reduce((t, c) => t + c.total, 0));
  const lifetimes = list.map((c) => Math.max(1, daysBetween(c.first, c.activeUntil < today ? c.activeUntil : today)) / 30.4);

  return {
    period: { from, to, days: length, previousFrom: prevFrom, previousTo: prevTo, bucket: weekly ? "week" : "day" },
    totals: { ...total, revenue: round2(total.revenue), spend: round2(total.spend), cash }, previous: { ...previous, revenue: round2(previous.revenue), spend: round2(previous.spend), cash: cashPrev },
    unit: unitEconomics(total, cash), unitPrevious: unitEconomics(previous, cashPrev),
    series: [...series.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, s]) => ({ day, ...s, revenue: round2(s.revenue), spend: round2(s.spend), cash: round2(s.cash) })),
    campaigns: [...byCampaign.entries()].map(([campaign, s]) => ({ campaign, ...s, revenue: round2(s.revenue), spend: round2(s.spend), ...unitEconomics(s, 0) })).sort((a, b) => b.customers - a.customers || b.started - a.started).slice(0, 25),
    monthly, retention, planMix,
    subscriptions: { activeNow: activeNow.length, mrr: round2(activeNow.reduce((t, c) => t + monthlyValue(c.plan), 0)), customersEver: list.length, lifetimeRevenue, ltv: ratio(lifetimeRevenue, list.length), avgLifetimeMonths: lifetimes.length ? round2(lifetimes.reduce((a, b) => a + b, 0) / lifetimes.length) : null, refundRate: ratio(paid.filter((p) => p.status === "refunded").length * 100, paid.length) },
    topCustomers: [...list].sort((a, b) => b.total - a.total).slice(0, 15).map((c) => ({ name: c.name, username: c.username, campaign: c.campaign, total: c.total, payments: c.count, first: c.first, last: c.last, plan: c.plan, active: c.activeUntil >= addDays(today, -3) })),
  };
}

export type Analytics = ReturnType<typeof computeAnalytics> & { extra: Record<string, unknown> | null; playbooks: unknown; spendEntries: unknown[]; campaignNames: string[]; sqlMissing: boolean; firstDay: string | null };

export async function getAnalytics(from: string, to: string): Promise<Analytics> {
  const today = spDate(new Date());
  const refresh = await db().rpc("refresh_daily_stats", { p_days: 120 });
  const sqlMissing = Boolean(refresh.error);
  const prevFrom = addDays(from, -(daysBetween(from, to) + 1));
  const [daily, spend, payments, extra, playbooks, first] = await Promise.all([
    db().from("daily_stats").select("*").gte("day", prevFrom).lte("day", to).limit(20000),
    db().from("ad_spend").select("id, day, campaign, amount, note, batch").order("day", { ascending: false }).limit(5000),
    db().from("payments").select("whop_payment_id, lead_id, whop_membership_id, plan_key, amount, status, is_first, created_at, refunded_at, leads(first_name, username, vip_active, campaign)").order("created_at", { ascending: true }).limit(10000),
    db().rpc("analytics_extra"),
    db().rpc("playbook_stats"),
    db().from("daily_stats").select("day").order("day", { ascending: true }).limit(1),
  ]);
  const spendRows = (spend.data ?? []) as SpendRow[];
  const batches = new Map<string, { batch: string; from: string; to: string; campaign: string; amount: number; note: string | null }>();
  for (const s of spendRows) {
    const b = batches.get(s.batch) ?? { batch: s.batch, from: s.day, to: s.day, campaign: s.campaign, amount: 0, note: s.note };
    b.amount = round2(b.amount + Number(s.amount)); if (s.day < b.from) b.from = s.day; if (s.day > b.to) b.to = s.day;
    batches.set(s.batch, b);
  }
  const dailyRows = (daily.data ?? []) as DailyRow[];
  return {
    ...computeAnalytics({ from, to, today, daily: dailyRows, spend: spendRows, payments: (payments.data ?? []) as unknown as PaymentRow[] }),
    extra: (extra.data as Record<string, unknown>) ?? null, playbooks: playbooks.data ?? [],
    spendEntries: [...batches.values()].sort((a, b) => b.to.localeCompare(a.to)).slice(0, 40),
    campaignNames: [...new Set(dailyRows.map((r) => r.campaign).filter(Boolean))].sort(),
    sqlMissing, firstDay: (first.data?.[0]?.day as string | undefined) ?? null,
  };
}

export async function saveSpend(input: { from: string; to: string; campaign: string; amount: number; note: string }): Promise<number> {
  const days = daysBetween(input.from, input.to) + 1;
  if (!(days >= 1 && days <= 366)) throw new Error("Tarih aralığı 1–366 gün olmalı.");
  if (!(input.amount >= 0 && input.amount < 10_000_000)) throw new Error("Tutar geçersiz.");
  const batch = `b${Date.now()}`;
  const perDay = Math.floor((input.amount / days) * 100) / 100;
  const rows = Array.from({ length: days }, (_, i) => ({ day: addDays(input.from, i), campaign: input.campaign.slice(0, 160), amount: i === days - 1 ? round2(input.amount - perDay * (days - 1)) : perDay, note: input.note.slice(0, 200) || null, batch }));
  const { error } = await db().from("ad_spend").insert(rows);
  if (error) throw new Error(`${error.message} — Supabase'de supabase/analytics.sql dosyasını çalıştırdınız mı?`);
  return days;
}

/* ------------------------------------------------------------------ */
/*  "Yapay zekâ analizi": the numbers go in, a prioritised action list comes out */
/* ------------------------------------------------------------------ */

const AI_PROMPT = `You are the growth analyst for a small Turkish business that sells a football-predictions (iddaa tips) Telegram subscription (free channel → AI sales bot → paid VIP via Whop, traffic from Meta ads). The owner is not a data person.
You receive a JSON snapshot of their analytics. Give an HONEST, specific diagnosis and a short prioritised action list.

Rules:
- Use ONLY the numbers given. If a number is missing or the sample is tiny (for example fewer than ~30 leads or fewer than ~5 customers), say clearly that it is too early to conclude and what volume is needed. Never invent benchmarks as facts; if you mention a typical range, label it as a rough rule of thumb.
- Find the single biggest leak in the funnel (largest relative drop) and start there.
- Judge profitability with CAC vs revenue per customer / LTV and ROAS; if spend is 0 or missing, say unit economics cannot be judged until ad spend is entered.
- Every action must be something the owner can do in THIS product: landing page copy, ad creative/targeting/budget, free-channel content, bot prompts / playbook / A/B tests, follow-up timing, plan pricing or mix, support speed, refund/churn handling, entering missing data.
- Forbidden advice: fake urgency or scarcity, invented results or testimonials, guarantees of winnings, pressuring people who said no, targeting minors or people with gambling problems, encouraging bigger bets, recommending betting sites.
- Write EVERYTHING in Turkish, plain language, short sentences, amounts in Turkish lira (₺).

Reply ONLY with a json object:
{"ozet":"3-5 cümle","saglik":"iyi|orta|zayıf|veri_yetersiz","en_buyuk_kayip":"huninin hangi adımı ve neden önemli","iyi_gidenler":["..."],"sorunlar":["..."],
 "oneriler":[{"oncelik":1,"baslik":"...","neden":"hangi sayıya dayanıyor","nasil":"panelde / reklamda tam olarak ne yapılacak","beklenen_etki":"...","zorluk":"kolay|orta|zor"}],
 "izlenecek_sayilar":["bir sonraki hafta hangi sayıya bakılmalı"],"eksik_veri":["..."]}
Give 3 to 6 items in "oneriler", ordered by priority.`;

export async function runAnalyticsAi(data: Analytics): Promise<Record<string, unknown>> {
  const env = getEnv();
  const compact = {
    period: data.period, totals: data.totals, previous_period: data.previous, unit_economics: data.unit, unit_economics_previous: data.unitPrevious,
    campaigns: data.campaigns.slice(0, 10), monthly: data.monthly.slice(-6), retention_by_first_payment_month: data.retention, plan_mix: data.planMix, subscriptions: data.subscriptions,
    extra: data.extra, conversion_by_playbook_version: data.playbooks, plans: BUSINESS.plans.map((p) => ({ key: p.key, price: p.price })),
  };
  const { json } = await deepseekJson({
    messages: [{ role: "system", content: AI_PROMPT }, { role: "user", content: `ANALYTICS (json):\n${JSON.stringify(compact)}` }],
    model: INTEGRATION_OVERRIDES.deepseekCoachModel || env.DEEPSEEK_COACH_MODEL || INTEGRATION_OVERRIDES.deepseekModel || env.DEEPSEEK_MODEL,
    thinking: true, maxTokens: 5000, timeoutMs: 170_000, retries: 1, label: "analytics-ai",
  });
  const result = (json && typeof json === "object" ? json : { ozet: "Yapay zekâ geçerli bir cevap üretemedi. Tekrar deneyin." }) as Record<string, unknown>;
  const entry = { at: new Date().toISOString(), period: data.period, result };
  const { data: row } = await db().from("app_state").select("value").eq("key", "analytics_ai").maybeSingle();
  const history = [entry, ...(Array.isArray(row?.value) ? row.value : [])].slice(0, 5);
  await db().from("app_state").upsert({ key: "analytics_ai", value: history, updated_at: new Date().toISOString() }, { onConflict: "key" });
  return entry;
}

export async function analyticsAiHistory(): Promise<unknown[]> {
  const { data } = await db().from("app_state").select("value").eq("key", "analytics_ai").maybeSingle();
  return Array.isArray(data?.value) ? data.value : [];
}
