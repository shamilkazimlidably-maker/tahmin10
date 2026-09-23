import type { Decision } from "./gate";
import { db } from "./supabase";

/** Her sayfa gösterimi küçük bir satır olarak kaydedilir (IP tutulmaz). 60 günden eskiler günlük temizlikte silinir. */
export async function logVisit(d: Decision, extra: { referer: string | null; query: Record<string, string> }): Promise<void> {
  try {
    const { error } = await db().from("page_visits").insert({
      page: d.page, reason: d.reason, country: d.country, ua: d.ua.slice(0, 300),
      referer: extra.referer?.slice(0, 300) ?? null, campaign: extra.query.utm_campaign?.slice(0, 120) ?? null, source: extra.query.utm_source?.slice(0, 120) ?? null,
    });
    if (error) console.error("[visits] insert:", error.message, "— supabase/visitor_filter.sql çalıştırıldı mı?");
  } catch (error) {
    console.error("[visits] insert:", error);
  }
}

export async function purgeVisits(days = 60): Promise<number> {
  const { data, error } = await db().from("page_visits").delete().lt("created_at", new Date(Date.now() - days * 86_400_000).toISOString()).select("id");
  if (error) return 0;
  return data?.length ?? 0;
}

type Row = { id: number; created_at: string; page: string; reason: string; country: string | null; ua: string | null; referer: string | null; campaign: string | null; source: string | null };

/** Panel için: son N günün özeti + son 150 ziyaret. Küçük hacim için TS tarafında toplanır. */
export async function visitorStats(days: number) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await db().from("page_visits").select("id, created_at, page, reason, country, ua, referer, campaign, source").gte("created_at", since).order("created_at", { ascending: false }).limit(5000);
  if (error) return { sqlMissing: true, total: 0, main: 0, safe: 0, byReason: [], byCountry: [], byDay: [], recent: [], truncated: false };
  const rows = (data ?? []) as Row[];
  const count = (key: (r: Row) => string | null | undefined) => {
    const m = new Map<string, number>();
    for (const r of rows) { const k = key(r) ?? "?"; m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m.entries()].map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);
  };
  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" });
  const byDayMap = new Map<string, { day: string; main: number; safe: number }>();
  for (let i = days - 1; i >= 0; i--) { const d = dayFmt.format(new Date(Date.now() - i * 86_400_000)); byDayMap.set(d, { day: d, main: 0, safe: 0 }); }
  for (const r of rows) { const d = byDayMap.get(dayFmt.format(new Date(r.created_at))); if (d) d[r.page === "safe" ? "safe" : "main"]++; }
  return {
    sqlMissing: false, total: rows.length, main: rows.filter((r) => r.page === "main").length, safe: rows.filter((r) => r.page === "safe").length,
    byReason: count((r) => r.reason), byCountry: count((r) => r.country), safeByCountry: count((r) => (r.page === "safe" ? r.country : null)).filter((x) => x.k !== "?"),
    byDay: [...byDayMap.values()], recent: rows.slice(0, 150), truncated: rows.length >= 5000,
  };
}
