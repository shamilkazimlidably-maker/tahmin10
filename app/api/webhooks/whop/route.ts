import { loadSettings } from "@/src/lib/settings";
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/src/lib/env";
import { db } from "@/src/lib/supabase";
import { notifyAdmin } from "@/src/lib/admin";
import { verifyWhopWebhook, WebhookSignatureError } from "@/src/lib/whop";
import { processMembership, processPaymentFailed, processPaymentSucceeded, processRefund } from "@/src/sales/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const env = getEnv();
  const rawBody = await request.text(); // signature is computed over the exact bytes

  let payload: Record<string, unknown>;
  try {
    payload = verifyWhopWebhook(rawBody, request.headers, env.WHOP_WEBHOOK_SECRET);
  } catch (error) {
    if (error instanceof WebhookSignatureError) return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const eventId = request.headers.get("webhook-id")!;
  await loadSettings();
  const type = String(payload.type ?? payload.action ?? "").replace(/_/g, ".").replace("membership.went.valid", "membership.activated").replace("membership.went.invalid", "membership.deactivated");
  const data = payload.data;

  // Idempotency: Whop retries until it gets a 2xx.
  const { error: insertError } = await db().from("webhook_events").insert({ id: eventId, type, payload });
  if (insertError) {
    if (insertError.code !== "23505") return NextResponse.json({ error: "database unavailable" }, { status: 500 });
    const { data: seen } = await db().from("webhook_events").select("status").eq("id", eventId).maybeSingle();
    if (seen?.status === "processed") return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    let result = "ignored";
    if (type === "payment.succeeded") result = await processPaymentSucceeded(data);
    else if (type === "payment.failed") result = await processPaymentFailed(data);
    else if (type === "refund.created" || type === "payment.refunded") result = await processRefund(type === "payment.refunded" ? { payment_id: (data as { id?: string })?.id } : data);
    else if (type === "membership.activated") result = await processMembership(data, true);
    else if (type === "membership.deactivated") result = await processMembership(data, false);

    await db().from("webhook_events").update({ status: "processed", error: null, processed_at: new Date().toISOString() }).eq("id", eventId);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = (error as Error).message.slice(0, 500);
    console.error("[whop webhook]", type, error);
    await db().from("webhook_events").update({ status: "failed", error: message }).eq("id", eventId);
    await notifyAdmin(`🚨 Whop bildirimi "${type}" işlenemedi, Whop tekrar deneyecek: ${message}`);
    return NextResponse.json({ error: "processing failed" }, { status: 500 }); // non-2xx → Whop retries
  }
}
