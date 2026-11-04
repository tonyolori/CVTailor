"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CvStyle, FactLibrarySchema, PreferencesSchema, ResumeSchema, type FactLibrary } from "@jobtailor/core";
import { requireAdmin, requireUser } from "@/lib/auth";
import { sendInvite } from "@/lib/email";
import { allow, clientIp } from "@/lib/rate-limit";
import { adminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export interface ActionResult {
  ok: boolean;
  message?: string;
}

/** Field paths only: enough to find the problem, with nothing of what the person typed. */
function issuesMessage(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "form"}: ${i.message}`)
    .join("; ");
}

// --- Auth -------------------------------------------------------------------
export async function signIn(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, message: "Enter a valid email address." };
  const h = await headers();
  if (!allow(`signin:${clientIp(h)}`, 10, 10 * 60_000)) {
    return { ok: false, message: "Too many attempts. Try again in a few minutes." };
  }
  const supabase = await createClient();
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? `https://${h.get("host")}`;
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${site}/auth/callback` } });
  if (error) {
    return { ok: false, message: /invite-only/i.test(error.message) ? "JobTailor is invite only for now, and this email isn't on the list yet. Join the waitlist and we'll email you when there's a place." : "Couldn't send the link. Try again shortly." };
  }
  return { ok: true, message: "Check your email for a sign-in link." };
}

/**
 * Anyone can register interest. The answer is the same whether or not the address is already
 * on the list, so this can't be used to find out who has signed up.
 */
export async function joinWaitlist(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) return { ok: false, message: "Enter a valid email address." };
  if (form.get("consent") !== "on") return { ok: false, message: "Tick the box so we can keep your details and email you." };
  // Filled in only by bots, since people never see this field. They get a normal-looking answer.
  if (String(form.get("website") ?? "")) return { ok: true };
  const h = await headers();
  if (!allow(`waitlist:${clientIp(h)}`, 5, 10 * 60_000)) return { ok: false, message: "Too many attempts. Try again in a few minutes." };
  const clean = (key: string, max: number) => String(form.get(key) ?? "").trim().slice(0, max) || null;
  const { error } = await adminClient()
    .from("waitlist")
    .upsert({ email, name: clean("name", 120), looking_for: clean("looking_for", 200), consented_at: new Date().toISOString() }, { onConflict: "email", ignoreDuplicates: true });
  if (error) return { ok: false, message: "Couldn't add you just now. Try again shortly." };
  return { ok: true };
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function giveConsent(): Promise<void> {
  const { supabase, user } = await requireUser();
  await supabase.from("profiles").update({ consented_at: new Date().toISOString() }).eq("id", user.id);
  redirect("/onboarding");
}

// --- Library and preferences --------------------------------------------------
export async function saveFacts(input: unknown, next?: string): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  const parsed = FactLibrarySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: issuesMessage(parsed.error) };
  const { error } = await supabase.from("fact_library").upsert({ user_id: user.id, data: parsed.data });
  if (error) return { ok: false, message: "Couldn't save your library." };
  revalidatePath("/library");
  if (next) redirect(next);
  return { ok: true, message: "Saved." };
}

export async function savePreferences(input: unknown, next?: string): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  const parsed = PreferencesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: issuesMessage(parsed.error) };
  const { error } = await supabase.from("preferences").upsert({ user_id: user.id, data: parsed.data });
  if (error) return { ok: false, message: "Couldn't save your preferences." };
  await supabase.from("profiles").update({ daily_cap: parsed.data.dailyCap }).eq("id", user.id);
  revalidatePath("/preferences");
  if (next) redirect(next);
  return { ok: true, message: "Saved. Changes apply from the next daily run." };
}

// --- Matches ------------------------------------------------------------------
const STATUSES = ["to_apply", "applied", "interview", "offer", "rejected", "dismissed"];

export async function setTrackerStatus(matchId: number, status: string): Promise<ActionResult> {
  if (!STATUSES.includes(status)) return { ok: false, message: "Unknown status." };
  const { supabase, user } = await requireUser();
  const { error } = await supabase.from("matches").update({ tracker_status: status }).eq("id", matchId).eq("user_id", user.id);
  revalidatePath("/dashboard");
  return error ? { ok: false, message: "Couldn't update that." } : { ok: true };
}

/** A style for this one CV, or null to follow the user's default. */
export async function setMatchCvStyle(matchId: number, style: string | null): Promise<ActionResult> {
  const value = style === null ? null : CvStyle.safeParse(style);
  if (value && !value.success) return { ok: false, message: "Unknown style." };
  const { supabase, user } = await requireUser();
  const { error } = await supabase.from("matches").update({ cv_style: value ? value.data : null }).eq("id", matchId).eq("user_id", user.id);
  revalidatePath("/dashboard");
  return error ? { ok: false, message: "Couldn't change the style." } : { ok: true };
}

// --- Resume versions ------------------------------------------------------------
export async function saveResumeVersion(matchId: number, input: unknown): Promise<ActionResult & { versionId?: number }> {
  const { supabase, user } = await requireUser();
  const parsed = ResumeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: issuesMessage(parsed.error) };
  const { data, error } = await supabase
    .from("resume_versions")
    .insert({ match_id: matchId, user_id: user.id, kind: "resume", source: "user", json: parsed.data })
    .select("id")
    .single();
  if (error) return { ok: false, message: "Couldn't save this version." };
  revalidatePath(`/matches/${matchId}`);
  return { ok: true, message: "Saved.", versionId: data.id };
}

/** "Add to my library" from an editor warning. Adds the term or fact the user confirmed. */
export async function addToLibrary(addition: { skill?: string; fact?: { text: string; org: string } }): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  const { data } = await supabase.from("fact_library").select("data").eq("user_id", user.id).single();
  const parsed = FactLibrarySchema.safeParse(data?.data);
  if (!parsed.success) return { ok: false, message: "Your library couldn't be read." };
  const lib: FactLibrary = parsed.data;

  if (addition.skill) {
    if (!lib.skills.some((s) => s.toLowerCase() === addition.skill!.toLowerCase())) lib.skills.push(addition.skill.trim());
  }
  if (addition.fact) {
    const entry = lib.entries.find((e) => e.org.toLowerCase() === addition.fact!.org.toLowerCase());
    if (!entry) return { ok: false, message: "No library entry for that employer. Add it from your library page." };
    entry.facts.push({ id: `user-${Date.now()}`, text: addition.fact.text.trim(), designCapacity: false });
  }
  const { error } = await supabase.from("fact_library").update({ data: lib }).eq("user_id", user.id);
  return error ? { ok: false, message: "Couldn't update your library." } : { ok: true, message: "Added to your library." };
}

// --- Settings ---
export async function setCvStyle(style: string): Promise<ActionResult> {
  const parsed = CvStyle.safeParse(style);
  if (!parsed.success) return { ok: false, message: "Unknown style." };
  const { supabase, user } = await requireUser();
  const { error } = await supabase.from("profiles").update({ cv_style: parsed.data }).eq("id", user.id);
  revalidatePath("/settings/cv-style");
  revalidatePath("/dashboard");
  return error ? { ok: false, message: "Couldn't save your CV style." } : { ok: true };
}
export async function updateSettings(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  const tz = String(form.get("tz") ?? "UTC");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    return { ok: false, message: "That time zone isn't recognised." };
  }
  const notify = String(form.get("notify_email") ?? "").trim();
  if (notify && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(notify)) return { ok: false, message: "That email address doesn't look right." };
  const dailyCap = Number(form.get("daily_cap"));
  if (!Number.isInteger(dailyCap) || dailyCap < 1 || dailyCap > 10) return { ok: false, message: "Daily limit must be from 1 to 10." };
  const sendTime = String(form.get("send_time") ?? "08:00");
  if (!/^\d{2}:\d{2}/.test(sendTime)) return { ok: false, message: "Enter a send time." };
  const { error } = await supabase
    .from("profiles")
    .update({
      tz,
      send_time: sendTime,
      daily_cap: dailyCap,
      notify_email: notify || null,
      active: form.get("paused") !== "on",
      email_paused: form.get("email_paused") === "on",
    })
    .eq("id", user.id);
  revalidatePath("/settings");
  return error ? { ok: false, message: "Couldn't save your settings." } : { ok: true, message: "Saved." };
}

// --- Admin ----------------------------------------------------------------------
export async function allowEmail(form: FormData): Promise<void> {
  await requireAdmin();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!email.includes("@")) return;
  await adminClient().from("allowed_emails").upsert({ email, note: String(form.get("note") ?? "") || null });
  revalidatePath("/admin");
}

export async function removeEmail(form: FormData): Promise<void> {
  await requireAdmin();
  await adminClient().from("allowed_emails").delete().eq("email", String(form.get("email")));
  revalidatePath("/admin");
}

/** Lets someone from the waitlist sign up, and tells them. A failed email doesn't undo the invitation. */
export async function inviteFromWaitlist(form: FormData): Promise<void> {
  await requireAdmin();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const db = adminClient();
  const { data } = await db.from("waitlist").select("email,name").eq("email", email).maybeSingle();
  if (!data) return;
  await db.from("allowed_emails").upsert({ email, note: data.name ? `Waitlist: ${data.name}` : "Waitlist" });
  const sent = await sendInvite(email);
  await db.from("waitlist").update({ invited_at: new Date().toISOString() }).eq("email", email);
  revalidatePath("/admin");
  redirect(sent ? "/admin?invited=1" : "/admin?invited=noemail");
}

export async function removeFromWaitlist(form: FormData): Promise<void> {
  await requireAdmin();
  await adminClient().from("waitlist").delete().eq("email", String(form.get("email")));
  revalidatePath("/admin");
}

export async function setKillSwitch(form: FormData): Promise<void> {
  await requireAdmin();
  await adminClient().from("app_settings").update({ value: form.get("on") === "true" }).eq("key", "kill_switch");
  revalidatePath("/admin");
}
