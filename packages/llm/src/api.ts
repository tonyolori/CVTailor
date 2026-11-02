import Anthropic from "@anthropic-ai/sdk";
import { withValidationRetry, type RawAttempt } from "./retry";
import { MAX_ANYOF_PARAMS, parseJsonLoose, toStrictJsonSchema, validateReply } from "./schema";
import { ZERO_USAGE, type LlmConfig, type LlmProvider, type LlmRequest, type LlmResult, type LlmUsage } from "./types";

interface Price {
  input: number;
  output: number;
  cacheRead: number;
}

/** USD per million tokens, first-party API. Used for budgets and cost reports only. */
const PRICES: Record<string, Price> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
};
/** Unknown models are costed high, so a config typo can't quietly defeat the budget. */
const FALLBACK_PRICE: Price = { input: 10, output: 50, cacheRead: 1 };

export function estimateCost(model: string, usage: Omit<LlmUsage, "costUsd" | "calls">, batch = false): number {
  const p = PRICES[model] ?? FALLBACK_PRICE;
  const usd =
    (usage.inputTokens * p.input +
      usage.outputTokens * p.output +
      usage.cacheReadTokens * p.cacheRead +
      usage.cacheWriteTokens * p.input * 1.25) /
    1_000_000;
  return batch ? usd / 2 : usd;
}

/** Below this many requests the Batch API's wait isn't worth the discount. */
const MIN_BATCH = 3;
const BATCH_POLL_MS = 60_000;
const BATCH_MAX_WAIT_MS = 3 * 60 * 60 * 1000;

type Format =
  | { mode: "structured"; schema: Record<string, unknown> }
  | { mode: "prompt"; schemaText: string };

/** Anthropic SDK with an API key: prompt caching, Batch API and refusal fallback. */
export class ApiProvider implements LlmProvider {
  readonly name = "anthropic-api" as const;
  private readonly client: Anthropic;
  /** Schemas the API rejected as too complex fall back to asking for JSON in the prompt. */
  private readonly promptOnly = new WeakSet<object>();

  constructor(
    private readonly config: LlmConfig,
    client?: Anthropic,
  ) {
    this.client = client ?? new Anthropic({ apiKey: config.apiKey });
  }

  private model(req: LlmRequest<unknown>): string {
    return req.tier === "small" ? this.config.modelSmall : this.config.modelStrong;
  }

  private format(req: LlmRequest<any>): Format {
    const { schema, anyOfCount } = toStrictJsonSchema(req.schema);
    if (anyOfCount > MAX_ANYOF_PARAMS || this.promptOnly.has(req.schema)) {
      return { mode: "prompt", schemaText: JSON.stringify(schema) };
    }
    return { mode: "structured", schema };
  }

  private params<T>(req: LlmRequest<T>, user: string) {
    const fmt = this.format(req);
    const system: Anthropic.TextBlockParam[] = [{ type: "text", text: req.system }];
    if (fmt.mode === "prompt") {
      system.push({
        type: "text",
        text: `Reply with only a JSON value matching this JSON Schema, no other text:\n${fmt.schemaText}`,
      });
    }
    if (req.cachedContext) {
      system.push({ type: "text", text: req.cachedContext, cache_control: { type: "ephemeral", ttl: "1h" } });
    }
    return {
      model: this.model(req),
      max_tokens: req.maxTokens ?? 16000,
      system,
      messages: [{ role: "user" as const, content: user }],
      output_config: {
        effort: req.effort ?? "low",
        ...(fmt.mode === "structured" ? { format: { type: "json_schema" as const, schema: fmt.schema } } : {}),
      },
    };
  }

  private usage(model: string, u: Anthropic.Usage, batch = false): LlmUsage {
    const tokens = {
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    };
    return { ...tokens, costUsd: estimateCost(model, tokens, batch), calls: 1 };
  }

  private interpret<T>(req: LlmRequest<T>, msg: Anthropic.Message, usage: LlmUsage): RawAttempt<T> {
    if (msg.stop_reason === "refusal") {
      return { ok: false, kind: "refusal", error: "model declined the request", usage };
    }
    if (msg.stop_reason === "max_tokens") {
      return { ok: false, kind: "other", error: "reply hit max_tokens", usage };
    }
    const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    let value: unknown;
    try {
      value = parseJsonLoose(text);
    } catch {
      return { ok: false, kind: "validation", error: "reply was not JSON", forModel: "Reply with JSON only.", usage };
    }
    const v = validateReply(req.schema, value);
    if (v.ok) return { ok: true, data: v.data, usage };
    return { ok: false, kind: "validation", error: v.error, forModel: v.forModel, usage };
  }

  complete<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    return withValidationRetry(req, (user) => this.attempt(req, user));
  }

  private async attempt<T>(req: LlmRequest<T>, user: string): Promise<RawAttempt<T>> {
    const params = this.params(req, user);
    try {
      // Haiku has no server-side refusal fallback; the other tiers do.
      const msg = /haiku/.test(params.model)
        ? await this.client.messages.create(params)
        : ((await this.client.beta.messages.create({
            ...params,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
          } as never)) as unknown as Anthropic.Message);
      return this.interpret(req, msg, this.usage(params.model, msg.usage));
    } catch (err) {
      if (err instanceof Anthropic.BadRequestError && /too complex/i.test(err.message) && !this.promptOnly.has(req.schema)) {
        this.promptOnly.add(req.schema);
        return this.attempt(req, user);
      }
      return { ok: false, usage: ZERO_USAGE, ...classifyApiError(err) };
    }
  }

  async completeMany<T>(reqs: LlmRequest<T>[]): Promise<Map<string, LlmResult<T>>> {
    const results = new Map<string, LlmResult<T>>();
    if (reqs.length < MIN_BATCH) {
      for (const req of reqs) results.set(req.id, await this.complete(req));
      return results;
    }

    const byId = new Map(reqs.map((r) => [r.id, r]));
    try {
      let batch = await this.client.messages.batches.create({
        requests: reqs.map((r) => ({ custom_id: r.id, params: this.params(r, r.user) })),
      });
      const deadline = Date.now() + BATCH_MAX_WAIT_MS;
      while (batch.processing_status !== "ended") {
        if (Date.now() > deadline) {
          await this.client.messages.batches.cancel(batch.id);
          throw new Error("batch timed out");
        }
        await new Promise((resolve) => setTimeout(resolve, BATCH_POLL_MS));
        batch = await this.client.messages.batches.retrieve(batch.id);
      }
      for await (const entry of await this.client.messages.batches.results(batch.id)) {
        const req = byId.get(entry.custom_id);
        if (!req) continue;
        if (entry.result.type !== "succeeded") {
          // Retry one at a time: an expired or errored item shouldn't lose the whole batch.
          results.set(req.id, await this.complete(req));
          continue;
        }
        const msg = entry.result.message;
        const attempt = this.interpret(req, msg, this.usage(msg.model, msg.usage, true));
        if (attempt.ok) {
          results.set(req.id, { ok: true, data: attempt.data, usage: attempt.usage });
        } else if (attempt.kind === "validation") {
          const retry = await this.complete({
            ...req,
            user: `${req.user}\n\nYour previous reply failed validation. Fix these fields and reply again:\n${attempt.forModel}`,
          });
          results.set(req.id, retry);
        } else {
          results.set(req.id, { ok: false, kind: attempt.kind, error: attempt.error, usage: attempt.usage });
        }
      }
    } catch (err) {
      const { kind, error } = classifyApiError(err);
      for (const r of reqs) {
        if (!results.has(r.id)) results.set(r.id, { ok: false, kind, error, usage: ZERO_USAGE });
      }
    }
    return results;
  }
}

function classifyApiError(err: unknown): { kind: "rate_limit" | "auth" | "other"; error: string } {
  if (err instanceof Anthropic.RateLimitError) return { kind: "rate_limit", error: "API rate limit" };
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return { kind: "auth", error: "API key rejected" };
  }
  if (err instanceof Anthropic.APIError) return { kind: "other", error: `API error ${err.status ?? "unknown"}` };
  return { kind: "other", error: "API call failed" };
}
