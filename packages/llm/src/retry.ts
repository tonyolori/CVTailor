import { addUsage, ZERO_USAGE, type LlmRequest, type LlmResult, type LlmUsage } from "./types";

export const MAX_VALIDATION_RETRIES = 2;

export type RawAttempt<T> =
  | { ok: true; data: T; usage: LlmUsage }
  | { ok: false; kind: "validation"; error: string; forModel: string; usage: LlmUsage }
  | { ok: false; kind: "refusal" | "rate_limit" | "auth" | "other"; error: string; usage: LlmUsage };

/** Runs one request, feeding validation errors back to the model, at most twice. */
export async function withValidationRetry<T>(
  req: LlmRequest<T>,
  attempt: (user: string) => Promise<RawAttempt<T>>,
): Promise<LlmResult<T>> {
  let usage = ZERO_USAGE;
  let user = req.user;
  for (let i = 0; ; i++) {
    const r = await attempt(user);
    usage = addUsage(usage, r.usage);
    if (r.ok) return { ok: true, data: r.data, usage };
    if (r.kind !== "validation" || i >= MAX_VALIDATION_RETRIES) {
      return { ok: false, kind: r.kind, error: r.error, usage };
    }
    user = `${req.user}\n\nYour previous reply failed validation. Fix these fields and reply again:\n${r.forModel}`;
  }
}
