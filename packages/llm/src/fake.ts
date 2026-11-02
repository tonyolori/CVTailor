import { withValidationRetry } from "./retry";
import { validateReply } from "./schema";
import { ZERO_USAGE, type LlmProvider, type LlmRequest, type LlmResult } from "./types";

export type FakeHandler = (req: LlmRequest<unknown>, user: string) => unknown;

/** Deterministic provider for tests. The handler returns the raw model reply for a request. */
export class FakeProvider implements LlmProvider {
  readonly name = "fake" as const;
  readonly requests: LlmRequest<unknown>[] = [];

  constructor(
    private readonly handler: FakeHandler,
    private readonly costPerCall = 0.001,
  ) {}

  complete<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    return withValidationRetry(req, async (user) => {
      this.requests.push(req as LlmRequest<unknown>);
      const usage = { ...ZERO_USAGE, inputTokens: 100, outputTokens: 50, costUsd: this.costPerCall, calls: 1 };
      let raw: unknown;
      try {
        raw = this.handler(req as LlmRequest<unknown>, user);
      } catch (err) {
        return { ok: false, kind: "other", error: err instanceof Error ? err.message : "fake failed", usage };
      }
      const v = validateReply(req.schema, raw);
      if (v.ok) return { ok: true, data: v.data, usage };
      return { ok: false, kind: "validation", error: v.error, forModel: v.forModel, usage };
    });
  }

  async completeMany<T>(reqs: LlmRequest<T>[]): Promise<Map<string, LlmResult<T>>> {
    const out = new Map<string, LlmResult<T>>();
    for (const r of reqs) out.set(r.id, await this.complete(r));
    return out;
  }
}
