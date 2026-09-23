import { getEnv } from "./env";

/**
 * Values the owner can set in the admin panel (→ Entegrasyonlar) INSTEAD of Vercel environment variables.
 * Filled by src/lib/settings.ts. Empty = the Vercel variable is used.
 * (Telegram / Whop / DeepSeek / Supabase keys stay in Vercel: the app needs them before it can even read the database.)
 */
export const INTEGRATION_OVERRIDES: {
  metaPixelId?: string;
  metaAccessToken?: string;
  /** undefined = use META_TEST_EVENT_CODE from Vercel · "" = test mode OFF · "TEST123" = test mode ON */
  metaTestEventCode?: string;
  supportUsername?: string;
  freeChannelUrl?: string;
  vipChannelUrl?: string;
  deepseekModel?: string;
  deepseekCoachModel?: string;
} = {};

export function metaConfig(): { pixelId?: string; token?: string; testCode?: string; version: string } {
  const env = getEnv();
  const o = INTEGRATION_OVERRIDES;
  return {
    pixelId: o.metaPixelId || env.META_PIXEL_ID,
    token: o.metaAccessToken || env.META_ACCESS_TOKEN,
    testCode: o.metaTestEventCode !== undefined ? o.metaTestEventCode || undefined : env.META_TEST_EVENT_CODE,
    version: env.META_GRAPH_API_VERSION,
  };
}
