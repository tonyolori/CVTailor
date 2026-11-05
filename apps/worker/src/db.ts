import { createClient } from "@supabase/supabase-js";
import { DbError, type Db } from "@cvtailor/ai/db";
import { errorFields } from "@cvtailor/core/log";
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

/** What to log about an error: its step when it has one, never free text from elsewhere. */
export function errorInfo(err: unknown): { kind: string; detail?: string; code?: string; at?: string } {
  if (err instanceof DbError) return { kind: "DbError", detail: err.message };
  const { errorType, code, at } = errorFields(err);
  return { kind: errorType, code, at };
}
