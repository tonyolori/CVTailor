import "server-only";
import { redirect } from "next/navigation";
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

/** As requireUser, and sends people who haven't finished setup to the step they're on. */
export async function requireOnboarded() {
  const ctx = await requireUser();
  if (!ctx.profile.consented_at) redirect("/consent");
  const [{ data: facts }, { data: prefs }] = await Promise.all([
    ctx.supabase.from("fact_library").select("user_id").eq("user_id", ctx.user.id).maybeSingle(),
    ctx.supabase.from("preferences").select("user_id").eq("user_id", ctx.user.id).maybeSingle(),
  ]);
  if (!facts) redirect("/onboarding");
  if (!prefs) redirect("/onboarding/preferences");
  return ctx;
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
