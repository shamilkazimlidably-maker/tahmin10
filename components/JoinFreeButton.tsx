"use client";

import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { readCookie, visitorId } from "./MetaPixel";

const STANDARD = new Set(["Lead", "CompleteRegistration", "Contact", "ViewContent", "InitiateCheckout", "AddToCart", "Purchase", "Subscribe", "StartTrial", "SubmitApplication", "Schedule", "Search", "AddPaymentInfo", "AddToWishlist", "CustomizeProduct", "Donate", "FindLocation"]);

function TelegramIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24">
      <path fill="currentColor" d="M21.94 4.3 18.7 19.6c-.24 1.08-.88 1.34-1.78.84l-4.92-3.63-2.38 2.29c-.26.26-.48.48-.99.48l.35-5.02 9.13-8.25c.4-.35-.08-.55-.62-.2L6.2 13.22l-4.86-1.52c-1.06-.33-1.08-1.06.22-1.56L20.55 3c.88-.33 1.65.2 1.39 1.3Z" />
    </svg>
  );
}

/** One shared click handler: creates the lead, fires the pixel event with the same id as the server, opens Telegram. */
function useJoin() {
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  // Works without JavaScript too: the server route creates the lead and redirects.
  const [href, setHref] = useState("/api/lead/start");
  useEffect(() => setHref(`/api/lead/start${window.location.search}`), []);

  const onClick = useCallback(
    async (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      if (busy) return;
      setBusy(true);
      const q = new URLSearchParams(window.location.search);
      try {
        const response = await fetch("/api/lead/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          keepalive: true,
          body: JSON.stringify({
            visitorId: visitorId(),
            source: q.get("utm_source"), medium: q.get("utm_medium"), campaign: q.get("utm_campaign"),
            adset: q.get("utm_term") ?? q.get("adset"), ad: q.get("utm_content") ?? q.get("ad"),
            fbclid: q.get("fbclid"), fbc: readCookie("_fbc"), fbp: readCookie("_fbp"),
            landingUrl: window.location.href.slice(0, 1000),
          }),
        });
        const data = (await response.json()) as { telegramUrl?: string; eventId?: string | null; eventName?: string };
        if (!data.telegramUrl) throw new Error("no url");
        // Same event id as the server-side event → Meta counts ONE click, not two.
        if (data.eventId && window.fbq) {
          const name = data.eventName ?? "Contact";
          window.fbq(STANDARD.has(name) ? "track" : "trackCustom", name, { content_name: "telegram_cta" }, { eventID: data.eventId });
        }
        const url = data.telegramUrl;
        window.setTimeout(() => {
          window.location.href = url;
          // Some in-app browsers (Instagram / Facebook) refuse to open other apps: offer a plain link as plan B.
          window.setTimeout(() => { setOpened(url); setBusy(false); }, 1800);
        }, 250);
      } catch {
        window.location.href = href;
      }
    },
    [busy, href],
  );
  return { busy, opened, href, onClick };
}

type Props = { label?: string; variant?: "primary" | "ghost" | "compact"; id?: string; hint?: string };

export default function JoinFreeButton({ label = "Telegram'da Aç", variant = "primary", id, hint }: Props) {
  const { busy, opened, href, onClick } = useJoin();
  return (
    <>
      <a id={id} className={`cta cta--${variant}`} href={href} onClick={onClick} rel="nofollow" aria-busy={busy}>
        <TelegramIcon />
        <span>{busy ? "Telegram açılıyor…" : label}</span>
      </a>
      {opened && hint ? (
        <a className="cta-hint" href={opened} rel="nofollow">
          {hint}
        </a>
      ) : null}
    </>
  );
}

/** Bottom bar that slides in once the main button has scrolled out of view (the thumb never has to travel back up). */
export function StickyJoin({ text, label, watch = "hero-cta" }: { text?: string; label: string; watch?: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const target = document.getElementById(watch);
    if (!target || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(([entry]) => setShow(!entry!.isIntersecting && entry!.boundingClientRect.top < 0), { threshold: 0 });
    observer.observe(target);
    return () => observer.disconnect();
  }, [watch]);
  return (
    <div className={`sticky ${show ? "sticky--on" : ""}`} aria-hidden={!show}>
      {text ? <span className="sticky__text">{text}</span> : null}
      <JoinFreeButton label={label} variant="compact" />
    </div>
  );
}
