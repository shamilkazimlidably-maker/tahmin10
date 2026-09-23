import { BUSINESS, getPlan } from "../config/business";
import { META_EVENTS } from "../config/funnel";
import { tx } from "../config/texts";
import { notifyAdmin } from "../lib/admin";
import { db, must } from "../lib/supabase";
import { getLeadById, getLeadByMembership, recordEvent, recordMessage, updateLead, type Lead } from "../lib/leads";
import { sendMetaEvent } from "../lib/meta";
import { sendText } from "../lib/telegram";
import { planKeyFromWhopId, readAmount, readMetadata, readPaymentRefs } from "../lib/whop";
import { deliverVipAccess, revokeVipAccess } from "./access";

type Dict = Record<string, unknown>;
const asDict = (v: unknown): Dict => (v && typeof v === "object" ? (v as Dict) : {});
const asString = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Follows `merged_into`, so a payment made from an old link still lands on the surviving lead. */
async function resolveLeadId(id: string | undefined): Promise<Lead | null> {
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  for (let i = 0; i < 3 && id; i++) {
    const { data } = await db().from("leads").select("*").eq("id", id).maybeSingle();
    if (!data) return null;
    if (!data.merged_into) return data as Lead;
    id = data.merged_into as string;
  }
  return null;
}

/**
 * Only used when the payment carries no lead metadata (plain checkout link).
 * We link it ONLY if exactly one unpaid person opened this plan's checkout in
 * the last 3 hours. Anything ambiguous goes to the owner — VIP access is never guessed.
 */
async function matchByRecentCheckout(planKey: string | null): Promise<Lead | null> {
  if (!planKey) return null;
  const since = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  const rows = must(
    await db()
      .from("leads")
      .select("*")
      .eq("checkout_started", true)
      .eq("paid", false)
      .eq("last_checkout_plan", planKey)
      .is("merged_into", null)
      .gte("checkout_started_at", since)
      .limit(2),
    "payments.recentCheckout",
  ) as Lead[];
  return rows.length === 1 ? rows[0]! : null;
}

export async function processPaymentSucceeded(data: unknown, options: { forceLead?: Lead } = {}): Promise<string> {
  const refs = readPaymentRefs(data);
  if (!refs.paymentId) throw new Error("payment.succeeded without a payment id");
  const meta = readMetadata(data);
  const { amount, currency } = readAmount(data);
  const planKey = planKeyFromWhopId(refs.planId) ?? (getPlan(meta.plan_key ?? "")?.key ?? null);
  const plan = planKey ? getPlan(planKey) : undefined;

  const existing = must(
    await db().from("payments").select("id, lead_id").eq("whop_payment_id", refs.paymentId).maybeSingle(),
    "payments.find",
  ) as { id: number; lead_id: string | null } | null;
  const alreadyCounted = Boolean(existing?.lead_id);

  let matchedBy: string | null = null;
  let lead: Lead | null = null;
  if (options.forceLead) [lead, matchedBy] = [options.forceLead, "admin"];
  if (!lead && (lead = await resolveLeadId(meta.lead_id))) matchedBy = "metadata";
  if (!lead && refs.membershipId && (lead = await getLeadByMembership(refs.membershipId))) matchedBy = "membership";
  if (!lead && (lead = await matchByRecentCheckout(planKey))) matchedBy = "recent_checkout";

  const renewal = refs.billingReason === "subscription_cycle" || Boolean(lead?.paid && lead.whop_membership_id && lead.whop_membership_id === refs.membershipId);
  const isFirst = Boolean(lead) && !lead!.paid;

  must(
    await db()
      .from("payments")
      .upsert(
        {
          whop_payment_id: refs.paymentId,
          lead_id: lead?.id ?? null,
          whop_membership_id: refs.membershipId,
          whop_plan_id: refs.planId,
          plan_key: planKey,
          amount,
          currency,
          billing_reason: refs.billingReason,
          is_first: isFirst,
          matched_by: matchedBy,
          email: refs.email,
          status: "paid",
          raw: data as Dict,
        },
        { onConflict: "whop_payment_id" },
      ),
    "payments.upsert",
  );

  if (!lead) {
    await notifyAdmin(
      `💰❓ ${refs.paymentId} numaralı ödeme (${currency} ${amount.toFixed(2)}, ${plan?.name ?? refs.planId ?? "bilinmeyen plan"}, ${refs.email ?? "e-posta yok"}) bir Telegram kullanıcısına bağlanamadı.\n` +
        `Müşteriyi bul ve şunu çalıştır:\n/link ${refs.paymentId} <telegram_id>\nBöylece VIP erişimi gönderilir ve satış sayılır.`,
    );
    return "unlinked";
  }

  if (!alreadyCounted) {
    lead = await updateLead(lead.id, {
      paid: true,
      paid_at: lead.paid_at ?? new Date().toISOString(),
      first_paid_plan: lead.first_paid_plan ?? planKey,
      total_revenue: Number(lead.total_revenue ?? 0) + amount,
      currency,
      vip_active: true,
      whop_membership_id: refs.membershipId ?? lead.whop_membership_id,
      whop_user_id: refs.userId ?? lead.whop_user_id,
      refunded: false,
      stage: "PAID",
      outcome: "won",
      outcome_reason: "purchase",
      closed_at: lead.closed_at && lead.outcome === "won" ? lead.closed_at : new Date().toISOString(),
      ...(lead.outcome !== "won" ? { analyzed_at: null } : {}),
    });
    await recordEvent(lead.id, renewal ? "PAYMENT_RENEWED" : "PAYMENT_SUCCEEDED", { payment: refs.paymentId, plan: planKey, amount, currency, matched_by: matchedBy });
    await recordMessage(lead.id, "event", `Whop ödemeyi onayladı (${plan?.name ?? "VIP"}${renewal ? ", yenileme" : ""}).`);

    if (isFirst || META_EVENTS.sendRenewalsAsPurchase) {
      await sendMetaEvent({
        ...META_EVENTS.purchase,
        eventId: `purchase_${refs.paymentId}`,
        lead,
        email: refs.email,
        value: amount,
        currency,
        contentName: plan?.name ?? BUSINESS.vip.name,
        contentId: planKey ?? undefined,
      });
    }
    await notifyAdmin(
      `💰 ${renewal ? "Yenileme" : "YENİ SATIŞ"}: ${lead.first_name ?? "Kişi"} (@${lead.username ?? "-"}) — ${plan?.name ?? "VIP"} ${currency} ${amount.toFixed(2)}` +
        `${lead.campaign ? ` · kampanya ${lead.campaign}` : ""}${matchedBy === "recent_checkout" ? "\n⚠️ Son ödeme sayfası açılışına göre eşleştirildi (ödemede kişi bilgisi yoktu). Doğru kişi olduğunu kontrol et." : ""}`,
    );
  }

  // Idempotent (vip_access_sent). Also covers a returning customer whose access had been revoked.
  await deliverVipAccess(lead, plan?.name ?? BUSINESS.vip.name);
  return alreadyCounted ? "duplicate" : renewal ? "renewal" : "sale";
}

export async function processPaymentFailed(data: unknown): Promise<string> {
  const refs = readPaymentRefs(data);
  const lead = (await resolveLeadId(readMetadata(data).lead_id)) ?? (refs.membershipId ? await getLeadByMembership(refs.membershipId) : null);
  if (!lead) return "no lead";
  const since = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
  const { data: recent } = await db().from("sales_events").select("id").eq("lead_id", lead.id).eq("name", "PAYMENT_FAILED").gte("created_at", since).limit(1);
  await recordEvent(lead.id, "PAYMENT_FAILED", { payment: refs.paymentId, reason: refs.billingReason });
  // Renewal failures are handled by Whop's own retries/e-mails. We only help with a first purchase, at most once per 12h.
  if (lead.paid || recent?.length || !lead.chat_id || lead.blocked || lead.opted_out || lead.do_not_sell) return "recorded";
  const text = tx("paymentFailed");
  await sendText(lead.chat_id, text).then(
    () => recordMessage(lead.id, "assistant", text),
    () => undefined,
  );
  return "customer notified";
}

export async function processRefund(data: unknown): Promise<string> {
  const d = asDict(data);
  const paymentId = asString(d.payment_id) ?? asString(asDict(d.payment).id);
  if (!paymentId) return "refund without payment id";
  const row = must(await db().from("payments").select("id, lead_id, amount, status").eq("whop_payment_id", paymentId).maybeSingle(), "refund.find") as {
    id: number;
    lead_id: string | null;
    amount: number;
    status: string;
  } | null;
  if (!row) return "unknown payment";
  if (row.status === "refunded") return "duplicate";
  must(await db().from("payments").update({ status: "refunded", refunded_at: new Date().toISOString() }).eq("id", row.id), "refund.mark");

  const lead = row.lead_id ? await resolveLeadId(row.lead_id) : null;
  if (!lead) return "refunded (no lead)";
  const updated = await updateLead(lead.id, { refunded: true, total_revenue: Math.max(0, Number(lead.total_revenue ?? 0) - Number(row.amount ?? 0)) });
  await recordEvent(lead.id, "PAYMENT_REFUNDED", { payment: paymentId, amount: row.amount });
  await revokeVipAccess(updated, "refund");
  await notifyAdmin(`↩️ İade: ${lead.first_name ?? lead.id} (@${lead.username ?? "-"}) — ${row.amount}. VIP erişimi kaldırıldı.`);
  return "refunded";
}

export async function processMembership(data: unknown, active: boolean): Promise<string> {
  const d = asDict(data);
  const membershipId = asString(d.id);
  if (!membershipId) return "membership without id";
  const lead = (await getLeadByMembership(membershipId)) ?? (await resolveLeadId(readMetadata(data).lead_id));
  if (!lead) return "no lead";
  if (active) {
    if (lead.whop_membership_id !== membershipId) await updateLead(lead.id, { whop_membership_id: membershipId });
    return "membership linked";
  }
  // A person may have a NEWER active membership (e.g. switched plan): only revoke if this is the one we track.
  if (lead.whop_membership_id && lead.whop_membership_id !== membershipId) return "other membership";
  if (!lead.vip_active) return "already inactive";
  await revokeVipAccess(lead, "membership_deactivated");
  await notifyAdmin(`👋 VIP bitti: ${lead.first_name ?? lead.id} (@${lead.username ?? "-"}). VIP kanalından çıkarıldı.`);
  return "revoked";
}

/** Admin: /link <payment_id> <telegram_id> */
export async function linkPaymentToLead(paymentId: string, lead: Lead): Promise<string> {
  const row = must(await db().from("payments").select("lead_id, raw").eq("whop_payment_id", paymentId).maybeSingle(), "link.find") as {
    lead_id: string | null;
    raw: unknown;
  } | null;
  if (!row) return `${paymentId} numaralı ödeme bulunamadı.`;
  if (row.lead_id) return `${paymentId} numaralı ödeme zaten bağlı.`;
  const result = await processPaymentSucceeded(row.raw, { forceLead: lead });
  return `${paymentId} numaralı ödeme ${lead.first_name ?? lead.telegram_user_id} kişisine bağlandı (${result}). VIP erişimi gönderildi.`;
}
