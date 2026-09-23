import type { Metadata } from "next";
import { headers } from "next/headers";
import { after } from "next/server";
import MainLanding from "@/components/landing/MainLanding";
import SafeLanding from "@/components/landing/SafeLanding";
import { BUSINESS } from "@/src/config/business";
import { SAFE } from "@/src/config/safe";
import { currentDecision } from "@/src/lib/gate";
import { loadSettings } from "@/src/lib/settings";
import { logVisit } from "@/src/lib/visits";

/**
 * "/" iki sayfadan birini gösterir:
 *   • ana açılış sayfası  → gerçek ziyaretçiler (izin verilen ülkeler, gerçek tarayıcı)
 *   • Futbol Veri Merkezi → botlar, link önizleyiciler, otomasyon araçları, izin verilen ülkeler dışı
 * Karar her istekte sunucuda verilir (user-agent + Vercel ülke başlığı), URL değişmez.
 * Kurallar: panel → Ziyaretçi Filtresi. Önizleme (yalnızca panele giriş yapmışken): /?goruntule=veri  veya  /?goruntule=ana
 */
export const dynamic = "force-dynamic";

type Search = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export async function generateMetadata({ searchParams }: { searchParams: Search }): Promise<Metadata> {
  await loadSettings();
  const d = await currentDecision(first((await searchParams).goruntule));
  if (d.page === "safe") {
    return { title: SAFE.title, description: SAFE.metaDescription, openGraph: { title: SAFE.title, description: SAFE.metaDescription, locale: "tr_TR", type: "website" }, robots: { index: true, follow: true } };
  }
  return {
    title: `${BUSINESS.brand} — Günde 1 ücretsiz futbol tahmini, Telegram'da`,
    description: `Her gün veriye dayalı 1 ücretsiz futbol tahmini, ${BUSINESS.brand} Telegram kanalında. ${BUSINESS.minimumAge} yaş üstü için.`,
    openGraph: { title: BUSINESS.brand, description: "Günde 1 ücretsiz, veriye dayalı futbol tahmini, doğrudan Telegram'da.", locale: "tr_TR", type: "website" },
  };
}

export default async function Home({ searchParams }: { searchParams: Search }) {
  await loadSettings();
  const sp = await searchParams;
  const d = await currentDecision(first(sp.goruntule));
  const referer = (await headers()).get("referer");
  const query = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, first(v) ?? ""]));
  after(() => logVisit(d, { referer, query }));
  return d.page === "safe" ? <SafeLanding /> : <MainLanding />;
}
