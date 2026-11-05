export type LogField = string | number | boolean | null | undefined;

/**
 * Field names that may hold free text. Logging them throws in tests and is dropped in
 * production, so a CV, email address or fact can't reach the logs by accident.
 */
const FORBIDDEN = /^(text|html|body|email|prompt|facts?|resume|cv|letter|summary|description|content|name|title)$/i;

const ADDRESS = /[^\s@"'<>(),;:]+@[^\s@"'<>(),;:]+\.[^\s@"'<>(),;:]+/g;

const MAX_CHARS = 120;

/** The fields of a log line, safe to print: ids and counts, with free text refused. */
export function safeLogFields(fields: Record<string, LogField>): Record<string, LogField> {
  const safe: Record<string, LogField> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (FORBIDDEN.test(k)) {
      if (typeof process !== "undefined" && process.env.VITEST) throw new Error(`log(): field "${k}" may hold personal text`);
      continue;
    }
    if (typeof v !== "string") {
      safe[k] = v;
      continue;
    }
    const clean = v.replace(ADDRESS, "[email]");
    safe[k] = clean.length > MAX_CHARS ? `${clean.slice(0, MAX_CHARS)}…` : clean;
  }
  return safe;
}

/** A code from another system, if it's a plain identifier. Anything else could be free text. */
export function logIdentifier(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value);
  return /^[\w.-]{1,80}$/.test(text) ? text : undefined;
}

/**
 * What to log about an error. Never its message: a parser's message can quote what it was
 * reading, which may be someone's CV. The type, code and location are enough to find it.
 */
export function errorFields(err: unknown): { errorType: string; code?: string; at?: string } {
  if (!(err instanceof Error)) return { errorType: "unknown" };
  const code = logIdentifier((err as { code?: unknown }).code) ?? logIdentifier((err.cause as { code?: unknown } | undefined)?.code);
  const at = err.stack?.split("\n").find((line) => /^\s+at /.test(line))?.trim();
  return { errorType: err.name, code, at };
}

/** The error code in a failed answer: Supabase Auth, PostgREST, Resend and Paystack each name it differently. */
export function bodyErrorCode(body: unknown): string | undefined {
  const b = body as { error_code?: unknown; code?: unknown; name?: unknown } | null | undefined;
  return logIdentifier(b?.error_code) ?? logIdentifier(b?.code) ?? logIdentifier(b?.name);
}
