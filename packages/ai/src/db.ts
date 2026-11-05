import type { SupabaseClient } from "@supabase/supabase-js";

/** A service-role client. It bypasses RLS, so it exists only in the worker and server-side web code. */
export type Db = SupabaseClient;

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
