"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    fbq?: ((...args: unknown[]) => void) & { callMethod?: (...a: unknown[]) => void; queue?: unknown[]; loaded?: boolean; version?: string; push?: unknown };
    _fbq?: unknown;
  }
}

export function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : null;
}

/** First-party visitor id: de-duplicates leads and is the `external_id` shared by the Pixel and the Conversions API. */
export function visitorId(): string {
  let id = readCookie("t10_vid");
  if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    document.cookie = `t10_vid=${id}; path=/; max-age=${60 * 60 * 24 * 180}; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
  }
  return id;
}

export default function MetaPixel({ pixelId }: { pixelId?: string }) {
  useEffect(() => {
    if (window.location.pathname.startsWith("/admin")) return;
    const vid = visitorId();
    if (!pixelId || window.fbq) return;

    const fbq = function (...args: unknown[]) {
      if (fbq.callMethod) fbq.callMethod(...args);
      else fbq.queue.push(args);
    } as NonNullable<Window["fbq"]> & { queue: unknown[] };
    fbq.queue = [];
    fbq.loaded = true;
    fbq.version = "2.0";
    fbq.push = fbq;
    window.fbq = fbq;
    window._fbq = fbq;

    const script = document.createElement("script");
    script.async = true;
    script.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(script);

    fbq("init", pixelId, { external_id: vid });
    fbq("track", "PageView");
  }, [pixelId]);

  return null;
}
