import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Config } from "./config";

export type Db = SupabaseClient;

/** Service-role client. Bypasses RLS, so it exists only in the worker. */
export function serviceClient(config: Pick<Config, "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY">): Db {
  if (!config.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Throws on a Supabase error so a failed write can't pass silently. */
export function must<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}
