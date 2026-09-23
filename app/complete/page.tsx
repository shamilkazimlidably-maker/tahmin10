import type { Metadata } from "next";
import { BUSINESS } from "@/src/config/business";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ödeme işleniyor — TAHMİN10", robots: { index: false } };

export default function Complete() {
  const bot = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "");
  return (
    <main className="doc">
      <p className="eyebrow">{BUSINESS.vip.name}</p>
      <h1>Az kaldı.</h1>
      <p>
        Whop ödemeyi onaylar onaylamaz VIP kanal erişimi <strong>Telegram'da botumuzla olan sohbetine</strong> gelir. Genellikle bir dakikadan kısa sürer.
      </p>
      <p>Ödeme tamamlanmadıysa hiçbir ücret alınmadı: bota dönüp /planlar yazarak tekrar deneyebilirsin.</p>
      {bot ? (
        <a className="cta cta--primary" href={`https://t.me/${bot}`}>
          Telegram'a dön
        </a>
      ) : null}
      <p className="micro">Birkaç dakika içinde gelmedi mi? Bota yaz, ekip kontrol eder.</p>
    </main>
  );
}
