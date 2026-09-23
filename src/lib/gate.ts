import { cache } from "react";
import { cookies, headers } from "next/headers";
import { GATE, isBotUserAgent } from "../config/gate";

export type VisitorPage = "main" | "safe";
export type VisitorReason = "ok" | "bot" | "country" | "no_country" | "forced" | "preview" | "disabled";
export type Decision = { page: VisitorPage; reason: VisitorReason; country: string | null; ua: string };

/** Saf karar fonksiyonu (test edilir). */
export function decideVisitor(i: { ua: string | null; country: string | null; preview?: string | null; isAdmin?: boolean }): Decision {
  const ua = (i.ua ?? "").slice(0, 300);
  const country = i.country ? i.country.toUpperCase().slice(0, 2) : null;
  if (i.isAdmin && (i.preview === "veri" || i.preview === "ana")) return { page: i.preview === "veri" ? "safe" : "main", reason: "preview", country, ua };
  if (!GATE.enabled) return { page: "main", reason: "disabled", country, ua };
  if (GATE.forceSafe) return { page: "safe", reason: "forced", country, ua };
  if (GATE.botsToSafe && isBotUserAgent(ua, GATE.extraBotKeywords)) return { page: "safe", reason: "bot", country, ua };
  const allowed = GATE.allowedCountries.split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s));
  if (allowed.length) {
    if (!country) return { page: GATE.unknownCountry === "safe" ? "safe" : "main", reason: "no_country", country, ua };
    if (!allowed.includes(country)) return { page: "safe", reason: "country", country, ua };
  }
  return { page: "main", reason: "ok", country, ua };
}

/** İstek başına bir kez hesaplanır (generateMetadata + sayfa aynı sonucu görür). Ülke: Vercel'in x-vercel-ip-country başlığı. */
export const currentDecision = cache(async (preview: string | null): Promise<Decision> => {
  const h = await headers();
  const c = await cookies();
  return decideVisitor({ ua: h.get("user-agent"), country: h.get("x-vercel-ip-country"), preview, isAdmin: Boolean(c.get("t10_admin")?.value) });
});
