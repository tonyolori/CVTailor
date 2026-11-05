import type { ZodType } from "zod";

export type ModelTier = "small" | "strong";
export type Effort = "low" | "medium" | "high";

export interface LlmRequest<T> {
  /** Caller's id for this item. Ids, never text, go in logs. */
  id: string;
  tier: ModelTier;
  /** Stable instructions. */
  system: string;
  /**
   * Stable per-user context such as one user's fact library. Cached where the provider
   * supports it. Never holds more than one user's data.
   */
  cachedContext?: string;
  /** The varying part of the prompt. Posting text goes here, as data. */
  user: string;
  schema: ZodType<T>;
  effort?: Effort;
  maxTokens?: number;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Estimated. In subscription mode this is notional: nothing is billed per call. */
  costUsd: number;
  calls: number;
}

export type LlmErrorKind = "validation" | "refusal" | "rate_limit" | "auth" | "other";

export type LlmResult<T> =
  | { ok: true; data: T; usage: LlmUsage }
  | { ok: false; kind: LlmErrorKind; error: string; usage: LlmUsage };

export interface LlmProvider {
  readonly name: "claude-subscription" | "anthropic-api" | "deepseek" | "fake";
  /** One request. Output is zod-validated; an invalid reply is retried at most twice. */
  complete<T>(req: LlmRequest<T>): Promise<LlmResult<T>>;
  /**
   * Many independent requests, for stages where timing allows. The API provider uses the
   * Batch API at half price; others run them directly and stop early on a rate limit.
   */
  completeMany<T>(reqs: LlmRequest<T>[]): Promise<Map<string, LlmResult<T>>>;
}

export interface LlmConfig {
  provider: LlmProvider["name"];
  modelSmall: string;
  modelStrong: string;
  apiKey?: string;
}

export const ZERO_USAGE: LlmUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
  calls: 0,
};

export function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    costUsd: a.costUsd + b.costUsd,
    calls: a.calls + b.calls,
  };
}
