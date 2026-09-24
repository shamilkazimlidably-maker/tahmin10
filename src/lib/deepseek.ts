import { INTEGRATION_OVERRIDES } from "./integrations";
import { getEnv } from "./env";
import { sleep } from "./util";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type JsonCallOptions = {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** DeepSeek V4 models have a thinking mode. Off for live chat (speed), on for the coach. */
  thinking?: boolean;
  model?: string;
  timeoutMs?: number;
  /** Extra attempts after the first one. */
  retries?: number;
  label?: string;
};

export type JsonCallResult = {
  json: unknown;
  usage: { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number } | null;
};

function parseLooseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    /* fall through */
  }
  const cleaned = text
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    /* fall through */
  }
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try { return JSON.parse(cleaned.slice(first, last + 1)); } catch { /* fall through */ }
  }
  // Kesilmiş / bozuk JSON: en azından "messages" dizisini kurtar (kişi cevapsız kalmasın).
  const salvaged = salvageMessages(cleaned);
  if (salvaged) return salvaged;
  throw new Error("Model did not return JSON.");
}

/** Truncated output (max_tokens) usually still contains the complete "messages" array at the top. */
function salvageMessages(text: string): { messages: string[]; _salvaged: true } | null {
  const m = text.match(/"messages"\s*:\s*\[([\s\S]*?)\]/);
  const raw = m?.[1] ?? "";
  const messages: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let s: RegExpExecArray | null;
  while ((s = re.exec(raw))) { try { messages.push(JSON.parse(`"${s[1]}"`)); } catch { /* skip */ } }
  return messages.length ? { messages, _salvaged: true } : null;
}

/**
 * Calls DeepSeek's OpenAI-compatible /chat/completions in JSON mode.
 * DeepSeek documents that JSON mode can occasionally return empty content,
 * so empty output is treated as retryable.
 */
export async function deepseekJson(options: JsonCallOptions): Promise<JsonCallResult> {
  const env = getEnv();
  const retries = options.retries ?? 1;
  const label = options.label ?? "deepseek";
  let sendThinkingParam = true;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 40_000);
    try {
      const body: Record<string, unknown> = {
        model: options.model ?? (INTEGRATION_OVERRIDES.deepseekModel || env.DEEPSEEK_MODEL),
        messages: options.messages,
        max_tokens: options.maxTokens ?? 1200,
        response_format: { type: "json_object" },
        stream: false,
      };
      if (sendThinkingParam) body.thinking = { type: options.thinking ? "enabled" : "disabled" };
      // Temperature is ignored by DeepSeek in thinking mode.
      if (!options.thinking) body.temperature = options.temperature ?? 0.7;

      const response = await fetch(`${env.DEEPSEEK_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        // A model that does not know the "thinking" parameter: retry without it.
        if (response.status === 400 && sendThinkingParam && /thinking/i.test(text)) {
          sendThinkingParam = false;
          attempt--;
          continue;
        }
        const error = new Error(`[${label}] HTTP ${response.status}: ${text.slice(0, 300)}`);
        // 401/402/404/422 will not fix themselves — do not waste the customer's time retrying.
        if ([400, 401, 402, 404, 422].includes(response.status)) {
          (error as Error & { fatal?: boolean }).fatal = true;
        }
        throw error;
      }

      const data = (await response.json()) as {
        choices?: { message?: { content?: string | null }; finish_reason?: string }[];
        usage?: JsonCallResult["usage"];
      };
      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error(`[${label}] empty content`);
      if (data.choices?.[0]?.finish_reason === "length") console.warn(`[${label}] output truncated at max_tokens=${options.maxTokens ?? 1200}`);
      try {
        return { json: parseLooseJson(content), usage: data.usage ?? null };
      } catch (parseError) {
        throw new Error(`[${label}] ${(parseError as Error).message}${data.choices?.[0]?.finish_reason === "length" ? " (cevap max_tokens sınırında kesildi)" : ""}: ${content.slice(0, 120)}`);
      }
    } catch (error) {
      lastError = error;
      if ((error as { fatal?: boolean }).fatal) break;
      if (attempt < retries) await sleep(600 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`[${label}] failed`);
}
