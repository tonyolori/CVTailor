import { withValidationRetry, type RawAttempt } from "./retry";
import { parseJsonLoose, toPromptJsonSchema, validateReply } from "./schema";
import { ZERO_USAGE, type Effort, type LlmConfig, type LlmProvider, type LlmRequest, type LlmResult, type LlmUsage } from "./types";

interface Price {
  input: number;
  output: number;
  cacheRead: number;
}

/**
 * USD per million tokens, off-peak. Used for budgets and cost reports only.
 * Docs: api-docs.deepseek.com/quick_start/pricing
 */
const PRICES: Record<string, Price> = {
  "deepseek-flash": { input: 0.15, output: 0.6, cacheRead: 0.003 },
  "deepseek-v4-pro": { input: 0.66, output: 1.98, cacheRead: 0.022 },
};
/** Unknown models are costed high, so a config typo can't quietly defeat the budget. */
const FALLBACK_PRICE: Price = { input: 10, output: 50, cacheRead: 1 };
const PEAK_MULTIPLIER = 2;

/** 01:00-04:00 and 06:00-10:00 UTC on weekdays. Chinese public holidays are off-peak too, but counting them as peak only overstates cost. */
function isPeak(at: Date): boolean {
  const day = at.getUTCDay();
  const hour = at.getUTCHours();
  return day >= 1 && day <= 5 && ((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10));
}

export function estimateDeepSeekCost(model: string, usage: Omit<LlmUsage, "costUsd" | "calls">, at: Date): number {
  const p = PRICES[model] ?? FALLBACK_PRICE;
  const usd = (usage.inputTokens * p.input + usage.outputTokens * p.output + usage.cacheReadTokens * p.cacheRead) / 1_000_000;
  return isPeak(at) ? usd * PEAK_MULTIPLIER : usd;
}

const API_URL = "https://api.deepseek.com/chat/completions";
const TIMEOUT_MS = 5 * 60_000;
const MAX_ATTEMPTS = 3;
const RETRY_PAUSE_MS = 2_000;
/** There's no Batch API to wait on, so a few run together to keep a daily run short. */
const CONCURRENCY = 5;

/** Thinking is on by default and billed as output, so only work that gains from it pays for it. */
const REASONING: Record<Effort, "none" | "low" | "high"> = { low: "none", medium: "low", high: "high" };

interface ChatCompletion {
  choices?: { finish_reason?: string; message?: { content?: string | null } }[];
  usage?: {
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
    completion_tokens?: number;
  };
}

export interface DeepSeekDeps {
  fetchFn?: typeof fetch;
  pause?: (ms: number) => Promise<void>;
  now?: () => Date;
}

/**
 * DeepSeek's chat API over plain HTTP. It has JSON mode but no schema parameter, so the schema
 * goes in the prompt, and zod checks the reply as it does for every provider. No request ever
 * carries tools, because postings are untrusted.
 * Docs: api-docs.deepseek.com/api/create-chat-completion
 */
export class DeepSeekProvider implements LlmProvider {
  readonly name = "deepseek" as const;
  private readonly fetchFn: typeof fetch;
  private readonly pause: (ms: number) => Promise<void>;
  private readonly now: () => Date;

  constructor(
    private readonly config: LlmConfig,
    deps: DeepSeekDeps = {},
  ) {
    // Switching provider without switching models would otherwise fail on every call of the run.
    for (const [name, model] of [["LLM_MODEL_SMALL", config.modelSmall], ["LLM_MODEL_STRONG", config.modelStrong]] as const) {
      if (!model.startsWith("deepseek-")) throw new Error(`LLM_PROVIDER=deepseek needs a DeepSeek model in ${name}`);
    }
    this.fetchFn = deps.fetchFn ?? fetch;
    this.pause = deps.pause ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = deps.now ?? (() => new Date());
  }

  private body<T>(req: LlmRequest<T>, user: string) {
    // Stable parts first: DeepSeek caches on a shared prefix, with no request parameter.
    const system = [
      req.system,
      `Reply with only a json object matching this JSON Schema, no other text:\n${JSON.stringify(toPromptJsonSchema(req.schema))}`,
      ...(req.cachedContext ? [req.cachedContext] : []),
    ].join("\n\n");
    return {
      model: req.tier === "small" ? this.config.modelSmall : this.config.modelStrong,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      reasoning_effort: REASONING[req.effort ?? "low"],
      max_tokens: req.maxTokens ?? 16000,
    };
  }

  complete<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    return withValidationRetry(req, (user) => this.attempt(req, user));
  }

  /** Stops early on a rate limit, a bad key or an empty balance, since the rest would fail the same way. */
  async completeMany<T>(reqs: LlmRequest<T>[]): Promise<Map<string, LlmResult<T>>> {
    const results = new Map<string, LlmResult<T>>();
    let next = 0;
    let stop: { kind: "rate_limit" | "auth"; error: string } | undefined;
    const worker = async () => {
      while (next < reqs.length) {
        const req = reqs[next++]!;
        if (stop) {
          results.set(req.id, { ok: false, ...stop, usage: ZERO_USAGE });
          continue;
        }
        const r = await this.complete(req);
        results.set(req.id, r);
        if (!r.ok && (r.kind === "rate_limit" || r.kind === "auth")) stop ??= { kind: r.kind, error: r.error };
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return results;
  }

  private async attempt<T>(req: LlmRequest<T>, user: string): Promise<RawAttempt<T>> {
    const body = this.body(req, user);
    const sent = await this.send(body);
    if (!sent.ok) return { ok: false, usage: ZERO_USAGE, kind: sent.kind, error: sent.error };

    const u = sent.reply.usage;
    const tokens = {
      inputTokens: u?.prompt_cache_miss_tokens ?? 0,
      outputTokens: u?.completion_tokens ?? 0,
      cacheReadTokens: u?.prompt_cache_hit_tokens ?? 0,
      cacheWriteTokens: 0,
    };
    const usage: LlmUsage = { ...tokens, costUsd: estimateDeepSeekCost(body.model, tokens, this.now()), calls: 1 };

    const choice = sent.reply.choices?.[0];
    if (choice?.finish_reason === "content_filter") return { ok: false, kind: "refusal", error: "model declined the request", usage };
    if (choice?.finish_reason === "length") return { ok: false, kind: "other", error: "reply hit max_tokens", usage };
    if (choice?.finish_reason !== "stop") return { ok: false, kind: "other", error: "reply did not finish", usage };

    let value: unknown;
    try {
      // A blank reply is a documented JSON mode outcome. It fails here and takes the normal retry.
      value = parseJsonLoose(choice.message?.content ?? "");
    } catch {
      return { ok: false, kind: "validation", error: "reply was not JSON", forModel: "Reply with JSON only.", usage };
    }
    const v = validateReply(req.schema, value);
    if (v.ok) return { ok: true, data: v.data, usage };
    return { ok: false, kind: "validation", error: v.error, forModel: v.forModel, usage };
  }

  /**
   * Only fixed text leaves this function, because a response can quote the prompt. A service
   * that stays down reports a rate limit, so the stage stops and its work waits for the next run.
   */
  private async send(body: unknown): Promise<{ ok: true; reply: ChatCompletion } | { ok: false; kind: "rate_limit" | "auth" | "other"; error: string }> {
    let failure = { ok: false as const, kind: "rate_limit" as const, error: "DeepSeek is unavailable" };
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      if (i > 0) await this.pause(RETRY_PAUSE_MS * 2 ** (i - 1));
      let res: Response;
      try {
        res = await this.fetchFn(API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.config.apiKey}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        continue;
      }
      if (res.ok) {
        try {
          return { ok: true, reply: (await res.json()) as ChatCompletion };
        } catch {
          return { ok: false, kind: "other", error: "DeepSeek sent an unreadable reply" };
        }
      }
      await res.body?.cancel();
      if (res.status === 401) return { ok: false, kind: "auth", error: "DeepSeek API key rejected" };
      if (res.status === 402) return { ok: false, kind: "auth", error: "DeepSeek balance is empty" };
      if (res.status === 429) failure = { ok: false, kind: "rate_limit", error: "DeepSeek rate limit" };
      else if (res.status !== 500 && res.status !== 503) return { ok: false, kind: "other", error: `API error ${res.status}` };
    }
    return failure;
  }
}
