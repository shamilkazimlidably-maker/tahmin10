import crypto from "node:crypto";
import { getEnv, planEnvId } from "./env";
import { BUSINESS, type PlanKey } from "../config/business";

/**
 * We talk to Whop's REST API directly instead of through @whop/sdk.
 * The SDK was rewritten between 0.x and 1.x (different client class,
 * `webhooks.unwrap` removed), which silently broke older integrations.
 * REST + a pinned `Api-Version-Date` header is stable, and webhook
 * verification below follows the Standard Webhooks spec that Whop uses.
 */

const WHOP_API = "https://api.whop.com/api/v1";

/**
 * WHOP_PLAN_* may hold the plan ID ("plan_AbC123") OR the plan's checkout
 * link copied from the Whop dashboard ("https://whop.com/checkout/plan_AbC123").
 */
export function parsePlanRef(value: string): { planId: string | null; url: string } {
  const planId = value.match(/plan_[A-Za-z0-9]+/)?.[0] ?? null;
  const url = /^https?:\/\//i.test(value) ? value : `https://whop.com/checkout/${planId ?? value}`;
  return { planId, url };
}

function planRef(plan: PlanKey) {
  const def = BUSINESS.plans.find((p) => p.key === plan);
  if (!def) throw new Error(`Unknown plan: ${plan}`);
  return parsePlanRef(planEnvId(def.envVar));
}

export function whopPlanId(plan: PlanKey): string {
  const { planId } = planRef(plan);
  if (!planId) throw new Error(`No plan_... ID found in the env var of plan "${plan}".`);
  return planId;
}

/** Plain checkout link: used when no API key is configured or the API call fails. Carries NO lead metadata. */
export function staticCheckoutUrl(plan: PlanKey): string {
  return planRef(plan).url;
}

export function planKeyFromWhopId(planId: string | null | undefined): PlanKey | null {
  if (!planId) return null;
  for (const plan of BUSINESS.plans) {
    if (parsePlanRef(planEnvId(plan.envVar)).planId === planId) return plan.key;
  }
  return null;
}

export type CheckoutConfiguration = { id: string; purchase_url: string };

export async function createCheckout(params: {
  plan: PlanKey;
  leadId: string;
  metadata?: Record<string, string>;
}): Promise<CheckoutConfiguration> {
  const env = getEnv();
  if (!env.WHOP_API_KEY) throw new Error("WHOP_API_KEY is not set.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${WHOP_API}/checkout_configurations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.WHOP_API_KEY}`,
        "Api-Version-Date": env.WHOP_API_VERSION_DATE,
      },
      body: JSON.stringify({
        ...(env.WHOP_COMPANY_ID ? { account_id: env.WHOP_COMPANY_ID } : {}),
        plan_id: whopPlanId(params.plan),
        mode: "payment",
        redirect_url: `${env.APP_URL}/complete`,
        // Whop copies this metadata onto the payment AND the membership,
        // which is how a payment finds its way back to the Telegram lead.
        metadata: { lead_id: params.leadId, plan_key: params.plan, source: "telegram_bot", ...(params.metadata ?? {}) },
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Whop checkout_configurations ${response.status}: ${text.slice(0, 400)}`);
    const data = JSON.parse(text) as { id?: string; purchase_url?: string | null };
    if (!data.id || !data.purchase_url) throw new Error("Whop did not return a purchase_url.");
    return { id: data.id, purchase_url: data.purchase_url };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/*  Webhook verification (Standard Webhooks)                           */
/* ------------------------------------------------------------------ */

export class WebhookSignatureError extends Error {}

const TOLERANCE_SECONDS = 5 * 60;

/**
 * signature = base64( HMAC_SHA256( secret, `${id}.${timestamp}.${rawBody}` ) )
 * Whop signs with the LITERAL bytes of the `ws_...` secret (verified against
 * the helper shipped in @whop/sdk 1.1.5). The header may carry several
 * space-separated signatures: "v1,<sig> v1,<sig2>".
 */
export function verifyWhopWebhook(rawBody: string, headers: Headers, secret: string): Record<string, unknown> {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatureHeader = headers.get("webhook-signature");
  if (!id || !timestamp || !signatureHeader) throw new WebhookSignatureError("Missing signature headers.");

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) throw new WebhookSignatureError("Invalid timestamp.");
  if (Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECONDS) throw new WebhookSignatureError("Timestamp outside tolerance.");

  const expected = crypto.createHmac("sha256", Buffer.from(secret, "utf8")).update(`${id}.${timestamp}.${rawBody}`).digest();

  const matches = signatureHeader.split(" ").some((part) => {
    const [version, signature] = part.split(",");
    if (version !== "v1" || !signature) return false;
    const given = Buffer.from(signature, "base64");
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
  if (!matches) throw new WebhookSignatureError("No matching signature.");

  return JSON.parse(rawBody) as Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  Tolerant payload readers (work across Whop API versions)           */
/* ------------------------------------------------------------------ */

type Dict = Record<string, unknown>;
const asDict = (v: unknown): Dict => (v && typeof v === "object" ? (v as Dict) : {});
const asString = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export function readMetadata(data: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(asDict(asDict(data).metadata))) {
    if (typeof v === "string" || typeof v === "number") out[k] = String(v);
  }
  return out;
}

/** New API: total = { amount: "97.00", currency: "brl" }. Older: final_amount / subtotal numbers. */
export function readAmount(data: unknown): { amount: number; currency: string } {
  const d = asDict(data);
  const money = asDict(d.total);
  let amount = Number(money.amount);
  if (!Number.isFinite(amount)) amount = Number(d.final_amount ?? d.amount ?? asDict(d.subtotal).amount ?? d.subtotal ?? 0);
  if (!Number.isFinite(amount)) amount = 0;
  const currency = (asString(money.currency) ?? asString(d.currency) ?? BUSINESS.currency).toUpperCase();
  return { amount, currency };
}

export function readPaymentRefs(data: unknown) {
  const d = asDict(data);
  return {
    paymentId: asString(d.id),
    status: asString(d.status),
    billingReason: asString(d.billing_reason),
    planId: asString(d.plan_id) ?? asString(asDict(d.plan).id),
    membershipId: asString(d.membership_id) ?? asString(asDict(d.membership).id),
    userId: asString(asDict(d.user).id) ?? asString(d.user_id),
    email: asString(d.customer_email) ?? asString(asDict(d.user).email),
  };
}
