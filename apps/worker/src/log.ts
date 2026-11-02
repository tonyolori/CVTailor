type Field = string | number | boolean | null | undefined;

/**
 * Field names that may hold free text. Logging them throws in tests and is dropped in
 * production, so a CV, email address or fact can't reach the logs by accident.
 */
const FORBIDDEN = /^(text|html|body|email|prompt|facts?|resume|cv|letter|summary|description|content|name|title)$/i;

/** Structured log line of ids and counts only. */
export function log(event: string, fields: Record<string, Field> = {}): void {
  const safe: Record<string, Field> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (FORBIDDEN.test(k)) {
      if (process.env.VITEST) throw new Error(`log(): field "${k}" may hold personal text`);
      continue;
    }
    safe[k] = typeof v === "string" && v.length > 120 ? `${v.slice(0, 120)}…` : v;
  }
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ...safe }));
}
