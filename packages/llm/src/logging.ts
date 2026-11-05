import type { LlmProvider, LlmRequest, LlmResult } from "./types";

type LogFn = (event: string, fields: Record<string, string | number | boolean | undefined>, level: "info" | "warn" | "error") => void;

function report<T>(log: LogFn, req: LlmRequest<T>, r: LlmResult<T>, ms: number): void {
  const { inputTokens, outputTokens, costUsd } = r.usage;
  // The failure's kind, never its text, which can quote the prompt or the reply.
  log("llm.response", { id: req.id, tier: req.tier, ok: r.ok, kind: r.ok ? undefined : r.kind, inputTokens, outputTokens, costUsd, ms }, r.ok ? "info" : "error");
}

/** Logs the outcome of every call a provider makes: ids, tokens and timing, with no prompt or reply. */
export function withLogging(inner: LlmProvider, log: LogFn): LlmProvider {
  return {
    name: inner.name,
    async complete<T>(req: LlmRequest<T>) {
      const started = Date.now();
      try {
        const r = await inner.complete(req);
        report(log, req, r, Date.now() - started);
        return r;
      } catch (err) {
        log("llm.threw", { id: req.id, tier: req.tier, errorType: err instanceof Error ? err.name : "unknown", ms: Date.now() - started }, "error");
        throw err;
      }
    },
    async completeMany<T>(reqs: LlmRequest<T>[]) {
      const started = Date.now();
      try {
        const results = await inner.completeMany(reqs);
        for (const req of reqs) {
          const r = results.get(req.id);
          if (r) report(log, req, r, Date.now() - started);
          else log("llm.no_result", { id: req.id, tier: req.tier }, "warn");
        }
        return results;
      } catch (err) {
        log("llm.threw", { requests: reqs.length, errorType: err instanceof Error ? err.name : "unknown", ms: Date.now() - started }, "error");
        throw err;
      }
    },
  };
}
