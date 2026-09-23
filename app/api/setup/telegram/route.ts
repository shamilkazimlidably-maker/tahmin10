import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/src/lib/env";
import { db } from "@/src/lib/supabase";
import { getMe, registerWebhook, tg } from "@/src/lib/telegram";
import { safeEqual } from "@/src/lib/util";
import { parsePlanRef } from "@/src/lib/whop";
import { BUSINESS } from "@/src/config/business";
import { notifyAdmin } from "@/src/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Check = { ok: boolean; detail: string };

async function channelCheck(channelId: string, botId: number, needInvite: boolean): Promise<Check> {
  try {
    const me = await tg<{ status: string; can_invite_users?: boolean }>("getChatMember", { chat_id: channelId, user_id: botId });
    if (me.status !== "administrator" && me.status !== "creator") return { ok: false, detail: `bot is "${me.status}" — make it an ADMIN of this channel` };
    if (needInvite && me.can_invite_users === false) return { ok: false, detail: 'bot is admin but lacks "Invite users via link" permission' };
    return { ok: true, detail: "bot is admin" };
  } catch (error) {
    return { ok: false, detail: `${(error as Error).message} — wrong channel ID, or the bot is not in the channel` };
  }
}

async function handle(request: NextRequest) {
  let env;
  try {
    env = getEnv();
  } catch (error) {
    return NextResponse.json({ ok: false, step: "environment variables", error: (error as Error).message }, { status: 500 });
  }
  const secret = request.headers.get("x-setup-secret") ?? request.nextUrl.searchParams.get("secret");
  if (!safeEqual(secret, env.SETUP_SECRET)) return NextResponse.json({ error: "unauthorized — add ?secret=YOUR_SETUP_SECRET" }, { status: 401 });

  const checks: Record<string, Check> = {};

  const { error: dbError } = await db().from("leads").select("id").limit(1);
  checks.database = dbError ? { ok: false, detail: `${dbError.message} — did you run supabase/schema.sql?` } : { ok: true, detail: "schema found" };
  const { error: fnError } = await db().rpc("funnel_stats", { p_since: null });
  checks.database_functions = fnError ? { ok: false, detail: `${fnError.message} — run supabase/schema.sql again` } : { ok: true, detail: "ok" };

  let webhook: Record<string, unknown> = {};
  try {
    const me = await getMe();
    checks.bot = me.username?.toLowerCase() === env.TELEGRAM_BOT_USERNAME.toLowerCase()
      ? { ok: true, detail: `@${me.username}` }
      : { ok: false, detail: `token belongs to @${me.username}, but TELEGRAM_BOT_USERNAME is "${env.TELEGRAM_BOT_USERNAME}"` };
    webhook = await registerWebhook();
    checks.webhook = { ok: webhook.url === `${env.APP_URL}/api/telegram/webhook`, detail: String(webhook.url) };
    checks.free_channel = await channelCheck(env.TELEGRAM_FREE_CHANNEL_ID, me.id, false);
    checks.vip_channel = env.TELEGRAM_VIP_CHANNEL_ID
      ? await channelCheck(env.TELEGRAM_VIP_CHANNEL_ID, me.id, true)
      : { ok: Boolean(env.TELEGRAM_VIP_CHANNEL_URL), detail: env.TELEGRAM_VIP_CHANNEL_URL ? "static VIP link only — set TELEGRAM_VIP_CHANNEL_ID for single-use links and automatic removal" : "no VIP channel configured" };
  } catch (error) {
    checks.bot = { ok: false, detail: (error as Error).message };
  }

  for (const plan of BUSINESS.plans) {
    const ref = parsePlanRef(env[plan.envVar]);
    checks[`whop_${plan.key}`] = ref.planId ? { ok: true, detail: ref.planId } : { ok: false, detail: `${plan.envVar} must contain a plan_... ID or the plan's checkout link` };
  }
  checks.whop_api_key = env.WHOP_API_KEY
    ? { ok: true, detail: "checkouts carry the lead ID (exact attribution)" }
    : { ok: false, detail: "missing — plain checkout links will be used and payments matched by 'recent checkout' (less reliable). Strongly recommended." };
  checks.meta = { ok: Boolean(env.META_PIXEL_ID && env.META_ACCESS_TOKEN), detail: env.META_PIXEL_ID && env.META_ACCESS_TOKEN ? "pixel + conversions API" : "not configured — tracking disabled" };
  checks.admin_chat = { ok: Boolean(env.TELEGRAM_ADMIN_CHAT_ID), detail: env.TELEGRAM_ADMIN_CHAT_ID ? "test message sent" : "TELEGRAM_ADMIN_CHAT_ID not set — no sale alerts, no /approve" };
  checks.support = { ok: Boolean(env.SUPPORT_USERNAME || env.SUPPORT_URL), detail: env.SUPPORT_USERNAME ?? env.SUPPORT_URL ?? "SUPPORT_USERNAME not set — handoffs only alert the admin" };

  const failed = Object.entries(checks).filter(([, c]) => !c.ok).map(([k]) => k);
  if (env.TELEGRAM_ADMIN_CHAT_ID) {
    await notifyAdmin(`✅ TAHMİN10 kurulumu çalıştı. ${failed.length ? `İlgilenmen gerekenler: ${failed.join(", ")}` : "Her şey yolunda görünüyor."}\nYönetici komutları için /help yaz.`);
  }
  return NextResponse.json({ ok: failed.length === 0, needs_attention: failed, checks, telegram_webhook_info: webhook }, { status: 200 });
}

export const GET = handle;
export const POST = handle;
