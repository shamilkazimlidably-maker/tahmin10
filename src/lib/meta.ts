import { getEnv } from "./env";
import { metaConfig } from "./integrations";
import { sha256 } from "./util";
import type { Lead } from "./leads";

type MetaEventInput = {
  name: string;
  actionSource: "website" | "chat";
  /** Same ID as the browser pixel event when both fire → Meta deduplicates. */
  eventId: string;
  /** false = the owner switched this event off in the admin panel. */
  enabled?: boolean;
  lead: Pick<
    Lead,
    "id" | "visitor_id" | "meta_fbc" | "meta_fbp" | "fbclid" | "client_ip" | "user_agent" | "landing_url" | "created_at"
  >;
  email?: string | null;
  value?: number;
  currency?: string;
  contentName?: string;
  contentId?: string;
  customData?: Record<string, unknown>;
};

function buildFbc(lead: MetaEventInput["lead"]): string | undefined {
  if (lead.meta_fbc) return lead.meta_fbc;
  if (!lead.fbclid) return undefined;
  // Meta's documented format when the cookie is absent: fb.1.<click time ms>.<fbclid>
  return `fb.1.${new Date(lead.created_at).getTime()}.${lead.fbclid}`;
}

/** Last rejection by Meta on this server instance (shown in the admin panel → Sistem). */
export let lastMetaError: { at: string; event: string; detail: string } | null = null;

/**
 * Never throws: analytics must not be able to break a sale.
 */
export async function sendMetaEvent(input: MetaEventInput): Promise<boolean> {
  try {
    if (input.enabled === false) return false;
    const cfg = metaConfig();
    if (!cfg.pixelId || !cfg.token) return false;
    const env = getEnv();

    const userData: Record<string, unknown> = {
      // Same value the browser pixel gets through advanced matching (it hashes it itself).
      external_id: [sha256(input.lead.visitor_id ?? input.lead.id)],
    };
    const fbc = buildFbc(input.lead);
    if (fbc) userData.fbc = fbc;
    if (input.lead.meta_fbp) userData.fbp = input.lead.meta_fbp;
    if (input.lead.client_ip) userData.client_ip_address = input.lead.client_ip;
    if (input.lead.user_agent) userData.client_user_agent = input.lead.user_agent;
    if (input.email) userData.em = [sha256(input.email.trim().toLowerCase())];

    // Meta REJECTS a "website" event that has no browser user agent. A person who opened the bot
    // directly (never saw the landing page) has none → report the event as "chat" instead of losing it.
    const actionSource = input.actionSource === "website" && !input.lead.user_agent ? "chat" : input.actionSource;

    const event: Record<string, unknown> = {
      event_name: input.name,
      event_time: Math.floor(Date.now() / 1000),
      event_id: input.eventId,
      action_source: actionSource,
      user_data: userData,
    };
    if (actionSource === "website") {
      event.event_source_url = input.lead.landing_url ?? env.APP_URL;
    }

    const custom: Record<string, unknown> = { ...(input.customData ?? {}) };
    if (typeof input.value === "number") {
      custom.value = Number(input.value.toFixed(2));
      custom.currency = input.currency ?? "BRL";
    }
    if (input.contentName) custom.content_name = input.contentName;
    if (input.contentId) {
      custom.content_ids = [input.contentId];
      custom.content_type = "product";
    }
    if (Object.keys(custom).length) event.custom_data = custom;

    const payload: Record<string, unknown> = { data: [event] };
    if (cfg.testCode) payload.test_event_code = cfg.testCode;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(
        `https://graph.facebook.com/${cfg.version}/${cfg.pixelId}/events?access_token=${encodeURIComponent(cfg.token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 400);
        console.error("[meta]", input.name, response.status, detail);
        lastMetaError = { at: new Date().toISOString(), event: input.name, detail: `${response.status} ${detail}` };
        return false;
      }
      return true;
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    console.error("[meta]", input.name, error);
    return false;
  }
}

/** Admin panel → "Bağlantıyı test et": sends one harmless event and returns Meta's literal answer. */
export async function testMetaConnection(): Promise<{ ok: boolean; detail: string }> {
  const cfg = metaConfig();
  if (!cfg.pixelId || !cfg.token) return { ok: false, detail: "Pixel ID veya erişim anahtarı (token) eksik." };
  const payload: Record<string, unknown> = {
    data: [{ event_name: "PanelConnectionTest", event_time: Math.floor(Date.now() / 1000), event_id: `paneltest_${Date.now()}`, action_source: "system_generated", user_data: { external_id: [sha256("palpite10-panel-test")] } }],
  };
  if (cfg.testCode) payload.test_event_code = cfg.testCode;
  try {
    const response = await fetch(`https://graph.facebook.com/${cfg.version}/${cfg.pixelId}/events?access_token=${encodeURIComponent(cfg.token)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000) });
    const body = (await response.text()).slice(0, 500);
    return { ok: response.ok, detail: body };
  } catch (error) {
    return { ok: false, detail: (error as Error).message };
  }
}
