import "server-only";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient } from "./supabase/admin";
import { createClient } from "./supabase/server";

export interface Profile {
  id: string;
  email: string;
  notify_email: string | null;
  display_name: string | null;
  tz: string;
  send_time: string;
  daily_cap: number;
  active: boolean;
  email_paused: boolean;
  plan: string;
  paid_until: string | null;
  consented_at: string | null;
  cv_style: string;
  cv_plan_left: number;
  cv_free_left: number;
  cv_extra_left: number;
}

/** Signed-in user and their profile. Redirects to login otherwise. */
export async function requireUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", data.user.id).single();
  if (!profile) redirect("/login");
  return { supabase, user: data.user, profile: profile as Profile };
}

export interface SetupStep {
  href: "/onboarding" | "/onboarding/preferences";
  /** Which of the two setup steps this is. */
  step: 1 | 2;
}

/**
 * The setup step someone still has to do, or null once they're done. Pages show it rather than
 * sending people to it, so anyone part way through can still go wherever they clicked.
 */
export async function setupStep(supabase: SupabaseClient, userId: string): Promise<SetupStep | null> {
  const [{ data: profile }, { data: facts }, { data: prefs }] = await Promise.all([
    supabase.from("profiles").select("consented_at").eq("id", userId).maybeSingle(),
    supabase.from("fact_library").select("user_id").eq("user_id", userId).maybeSingle(),
    supabase.from("preferences").select("user_id").eq("user_id", userId).maybeSingle(),
  ]);
  if (!profile?.consented_at || !facts) return { href: "/onboarding", step: 1 };
  if (!prefs) return { href: "/onboarding/preferences", step: 2 };
  return null;
}

export async function isAdmin(email: string): Promise<boolean> {
  const { data } = await adminClient().from("app_settings").select("value").eq("key", "admin_emails").maybeSingle();
  const list = (data?.value ?? []) as string[];
  const owner = process.env.OWNER_EMAIL?.toLowerCase();
  return list.map((e) => e.toLowerCase()).includes(email.toLowerCase()) || owner === email.toLowerCase();
}

export async function requireAdmin() {
  const ctx = await requireUser();
  if (!(await isAdmin(ctx.user.email ?? ""))) redirect("/dashboard");
  return ctx;
}
