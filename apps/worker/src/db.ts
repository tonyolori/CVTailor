import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { errorFields } from "@cvtailor/core/log";
import type { Config } from "./config";
import { failureLoggingFetch } from "./log";

export type Db = SupabaseClient;

/** Service-role client. Bypasses RLS, so it exists only in the worker. */
export function serviceClient(config: Pick<Config, "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY">): Db {
  if (!config.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: failureLoggingFetch },
  });
}

/** Names the step that failed, with quoted values removed so it's safe to log. */
export class DbError extends Error {
  constructor(
    readonly step: string,
    message: string,
  ) {
    super(`${step}: ${message.replace(/"[^"]*"/g, '"…"').slice(0, 120)}`);
    this.name = "DbError";
  }
}

/** Throws on a Supabase error so a failed write can't pass silently. */
export function must<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new DbError(what, result.error.message);
  return result.data;
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
