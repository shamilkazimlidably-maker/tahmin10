import { z } from "zod";

/**
 * Environment access is LAZY (never at import time) so `next build`
 * works before the variables exist, and every missing key is reported
 * by name the first time a route actually needs it.
 */

const url = z.string().trim().url();
const req = z.string().trim().min(1);
const opt = z.string().trim().min(1).optional();

const schema = z.object({
  APP_URL: url,
  SETUP_SECRET: req.min(16, "must be at least 16 characters"),
  CRON_SECRET: req.min(16, "must be at least 16 characters"),

  SUPABASE_URL: url,
  SUPABASE_SECRET_KEY: req,

  TELEGRAM_BOT_TOKEN: req.regex(/^\d+:[\w-]+$/, "does not look like a bot token"),
  TELEGRAM_BOT_USERNAME: req.transform((v) => v.replace(/^@/, "")),
  TELEGRAM_WEBHOOK_SECRET: req.regex(/^[A-Za-z0-9_-]{16,256}$/, "16–256 chars, only A-Z a-z 0-9 _ -"),
  TELEGRAM_FREE_CHANNEL_ID: req.regex(/^(-?\d+|@\w+)$/, "must look like -1001234567890 or @channel"),
  TELEGRAM_FREE_CHANNEL_URL: url,
  TELEGRAM_VIP_CHANNEL_ID: opt,
  TELEGRAM_VIP_CHANNEL_URL: url.optional(),
  TELEGRAM_ADMIN_CHAT_ID: opt,

  DEEPSEEK_API_KEY: req,
  DEEPSEEK_BASE_URL: url.default("https://api.deepseek.com"),
  DEEPSEEK_MODEL: req.default("deepseek-flash"),
  DEEPSEEK_COACH_MODEL: opt,

  WHOP_API_KEY: opt,
  WHOP_WEBHOOK_SECRET: req,
  WHOP_COMPANY_ID: opt,
  WHOP_PLAN_WEEKLY: req,
  WHOP_PLAN_MONTHLY: req,
  WHOP_PLAN_3_MONTHS: req,
  WHOP_API_VERSION_DATE: req.default("2026-09-15"),

  META_PIXEL_ID: opt,
  META_ACCESS_TOKEN: opt,
  META_GRAPH_API_VERSION: req.default("v26.0"),
  META_TEST_EVENT_CODE: opt,

  SUPPORT_USERNAME: opt,
  SUPPORT_URL: url.optional(),

  PLAYBOOK_AUTO_APPROVE: z
    .string()
    .optional()
    .transform((v) => (v ?? "").trim().toLowerCase() === "true"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

function clean(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

export function getEnv(): Env {
  if (cached) return cached;
  const e = process.env;

  const raw: Record<string, string | undefined> = {};
  for (const key of Object.keys(schema.shape)) raw[key] = clean(e[key]);

  // Friendly fallbacks / aliases.
  const vercelUrl = clean(e.VERCEL_PROJECT_PRODUCTION_URL);
  raw.APP_URL = (raw.APP_URL ?? clean(e.NEXT_PUBLIC_APP_URL) ?? (vercelUrl ? `https://${vercelUrl}` : undefined))?.replace(
    /\/+$/,
    "",
  );
  raw.SUPABASE_URL = raw.SUPABASE_URL ?? clean(e.NEXT_PUBLIC_SUPABASE_URL);
  raw.SUPABASE_SECRET_KEY = raw.SUPABASE_SECRET_KEY ?? clean(e.SUPABASE_SERVICE_ROLE_KEY);
  raw.WHOP_API_KEY = raw.WHOP_API_KEY ?? clean(e.WHOP_COMPANY_API_KEY);
  raw.DEEPSEEK_BASE_URL = raw.DEEPSEEK_BASE_URL?.replace(/\/+$/, "");

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`);
    console.error("[env] Invalid configuration:\n - " + problems.join("\n - "));
    throw new Error("Environment variables missing or invalid → " + problems.join(" | "));
  }
  cached = parsed.data;
  return cached;
}

/** For /api/health: reports problems by variable NAME only, never values. */
export function envProblems(): string[] {
  try {
    cached = undefined;
    getEnv();
    return [];
  } catch (error) {
    return (error as Error).message.replace(/^.*→ /, "").split(" | ");
  }
}

export function metaEnabled(): boolean {
  const env = getEnv();
  return Boolean(env.META_PIXEL_ID && env.META_ACCESS_TOKEN);
}

export function planEnvId(envVar: "WHOP_PLAN_WEEKLY" | "WHOP_PLAN_MONTHLY" | "WHOP_PLAN_3_MONTHS"): string {
  return getEnv()[envVar];
}
