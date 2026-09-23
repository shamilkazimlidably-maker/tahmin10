import { loadSettings } from "@/src/lib/settings";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { META_EVENTS } from "@/src/config/funnel";
import { getEnv } from "@/src/lib/env";
import { allowRequest } from "@/src/lib/rate-limit";
import { createLead, findRecentLeadByVisitor, recordEvent } from "@/src/lib/leads";
import { sendMetaEvent } from "@/src/lib/meta";
import { clientIp } from "@/src/lib/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => v || null)
    .catch(null);

const bodySchema = z.object({
  visitorId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional().nullable().catch(null),
  source: text(80),
  medium: text(80),
  campaign: text(160),
  adset: text(160),
  ad: text(160),
  fbclid: text(500),
  fbc: text(500),
  fbp: text(200),
  landingUrl: text(1000),
});

const botUrl = (token?: string) => `https://t.me/${getEnv().TELEGRAM_BOT_USERNAME}${token ? `?start=${token}` : ""}`;
const IS_ROBOT = /bot\b|crawler|spider|preview|facebookexternalhit|headless/i;

export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  if (!(await allowRequest(`lead:${ip ?? "unknown"}`, 10, 60))) {
    // Too many clicks: still let the person reach the bot, just without a new lead row.
    return NextResponse.json({ telegramUrl: botUrl(), eventId: null });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  const body = parsed.success ? parsed.data : bodySchema.parse({});
  const userAgent = request.headers.get("user-agent")?.slice(0, 400) ?? null;
  if (IS_ROBOT.test(userAgent ?? "")) return NextResponse.json({ telegramUrl: botUrl(), eventId: null });

  try {
    await loadSettings();
    // Same visitor clicking again → same lead, same event id (Meta de-duplicates).
    let lead = body.visitorId ? await findRecentLeadByVisitor(body.visitorId) : null;
    if (!lead) {
      lead = await createLead({ ...body, clientIp: ip, userAgent });
      await recordEvent(lead.id, "LANDING_CTA_CLICKED", { campaign: lead.campaign, ad: lead.ad });
      await sendMetaEvent({ ...META_EVENTS.ctaClick, eventId: `click_${lead.id}`, lead });
    }
    return NextResponse.json({ telegramUrl: botUrl(lead.start_token), eventId: META_EVENTS.ctaClick.enabled ? `click_${lead.id}` : null, eventName: META_EVENTS.ctaClick.name });
  } catch (error) {
    // The database being down must never stop someone from reaching the bot.
    console.error("[lead/start]", error);
    return NextResponse.json({ telegramUrl: botUrl(), eventId: null });
  }
}

/** No-JavaScript fallback: the CTA is a plain link to this URL. */
export async function GET(request: NextRequest) {
  const ip = clientIp(request);
  const userAgent = request.headers.get("user-agent")?.slice(0, 400) ?? null;
  try {
    if (IS_ROBOT.test(userAgent ?? "") || !(await allowRequest(`lead:${ip ?? "unknown"}`, 10, 60))) return NextResponse.redirect(botUrl(), 302);
    const q = request.nextUrl.searchParams;
    const lead = await createLead({
      source: q.get("utm_source"),
      medium: q.get("utm_medium"),
      campaign: q.get("utm_campaign"),
      adset: q.get("utm_term"),
      ad: q.get("utm_content"),
      fbclid: q.get("fbclid"),
      clientIp: ip,
      userAgent,
      landingUrl: request.headers.get("referer"),
    });
    await recordEvent(lead.id, "LANDING_CTA_CLICKED", { nojs: true });
    await sendMetaEvent({ ...META_EVENTS.ctaClick, eventId: `click_${lead.id}`, lead });
    return NextResponse.redirect(botUrl(lead.start_token), 302);
  } catch (error) {
    console.error("[lead/start GET]", error);
    return NextResponse.redirect(botUrl(), 302);
  }
}
