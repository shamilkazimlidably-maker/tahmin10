import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

const appUrl = process.env.APP_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined);

export const metadata: Metadata = {
  ...(appUrl ? { metadataBase: new URL(appUrl) } : {}),
  title: "TAHMİN10 — Günde 1 ücretsiz futbol tahmini, Telegram'da",
  description: "Her gün veriye dayalı 1 ücretsiz futbol tahmini, TAHMİN10 Telegram kanalında. 18 yaş üstü için.",
  openGraph: { title: "TAHMİN10", description: "Günde 1 ücretsiz, veriye dayalı futbol tahmini, doğrudan Telegram'da.", locale: "tr_TR", type: "website" },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = { themeColor: "#0b3d24", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body>
        {children}
      </body>
    </html>
  );
}
