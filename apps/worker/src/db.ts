import { createClient } from "@supabase/supabase-js";
import { DbError, type Db } from "@cvtailor/ai/db";
import { errorFields, exceptionField, EXCEPTION } from "@cvtailor/core/log";
import type { Config } from "./config";
import { failureLoggingFetch } from "./log";

export { DbError, must, type Db } from "@cvtailor/ai/db";

/** Service-role client. Bypasses RLS, so it exists only in the worker. */
export function serviceClient(config: Pick<Config, "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY">): Db {
  if (!config.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: failureLoggingFetch },
  });
}

/** Filter values go in the request URL, and a long list fails with "URI too long". */
export function chunks<T>(items: T[], size = 50): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Strings for an `in` filter, in batches that fit the request URL. A count alone isn't enough:
 * fifty long titles, encoded, overran it.
 */
export function urlChunks(values: string[], maxChars = 4000): string[][] {
  const out: string[][] = [];
  let batch: string[] = [];
  let used = 0;
  for (const v of values) {
    // Quotes and a comma around each value, once encoded.
    const cost = encodeURIComponent(v).length + 9;
    if (batch.length > 0 && used + cost > maxChars) {
      out.push(batch);
      batch = [];
      used = 0;
    }
    batch.push(v);
    used += cost;
  }
  if (batch.length > 0) out.push(batch);
  return out;
}

/** What to log about an error: its step when it has one, never free text from elsewhere. The error itself goes along to the alert. */
export function errorInfo(err: unknown): { kind: string; detail?: string; code?: string; at?: string; [EXCEPTION]: unknown } {
  if (err instanceof DbError) return { kind: "DbError", detail: err.message, ...exceptionField(err) };
  const { errorType, code, at } = errorFields(err);
  return { kind: errorType, code, at, ...exceptionField(err) };
}
