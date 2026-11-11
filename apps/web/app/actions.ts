"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { CvStyle, FactLibrarySchema, levelDefaults, PreferencesSchema, ResumeSchema, type FactLibrary, type Preferences } from "@cvtailor/core";
import { requireAdmin, requireUser, type Profile } from "@/lib/auth";
import { sendAddressConfirmation, sendInvite, sendWelcome } from "@/lib/email";
import { bodyErrorCode, log, logged } from "@/lib/log";
import { currentAddress, newToken, notifyChange } from "@/lib/notify-email";
import { cvCounts } from "@/lib/plan-settings";
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
export const signIn = logged("action.signIn", async (_prev: ActionResult | null, form: FormData): Promise<ActionResult> => {
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
    return { ok: false, message: /invite-only/i.test(error.message) ? "CV Tailor is invite only for now, and this email isn't on the list yet. Join the waitlist and we'll email you when there's a place." : "Couldn't send the link. Try again shortly." };
  }
  return { ok: true, message: "Check your email for a sign-in link." };
});

/**
 * Anyone can register interest. The answer is the same whether or not the address is already
 * on the list, so this can't be used to find out who has signed up.
 */
export const joinWaitlist = logged("action.joinWaitlist", async (_prev: ActionResult | null, form: FormData): Promise<ActionResult> => {
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
  if (error) {
    log("waitlist.join_failed", { code: error.code }, "error");
    return { ok: false, message: "Couldn't add you just now. Try again shortly." };
  }
  return { ok: true };
});

export const signOut = logged("action.signOut", async (): Promise<void> => {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
});

/** Asked for on the first onboarding step, before anything is stored or sent to an AI model. */
export const giveConsent = logged("action.giveConsent", async (): Promise<ActionResult> => {
  const { user, profile } = await requireUser();
  // Only the first consent sets the free CVs, so going through this twice can't top them up.
  const { data: started, error, status } = await adminClient()
    .from("profiles")
    .update({ consented_at: new Date().toISOString(), cv_free_left: cvCounts().free })
    .eq("id", user.id)
    .is("consented_at", null)
    .select("id");
  // The first consent is when the account starts, so it's the one that gets a welcome. After the
  // response, so the next page doesn't wait on the email.
  if (started?.length) {
    after(async () => {
      const sent = await sendWelcome(user.id, profile.notify_email ?? profile.email);
      if (!sent) log("email.welcome_failed", { userId: user.id }, "warn");
    });
  }
  if (error) log("consent.save_failed", { userId: user.id, status, code: bodyErrorCode(error) }, "error");
  return error ? { ok: false, message: "Couldn't save that. Try again." } : { ok: true };
});

// --- Library and preferences --------------------------------------------------
export const saveFacts = logged("action.saveFacts", async (input: unknown, next?: string): Promise<ActionResult> => {
  const { supabase, user, profile } = await requireUser();
  if (!profile.consented_at) return { ok: false, message: "Agree to how CV Tailor uses your details first." };
  const parsed = FactLibrarySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: issuesMessage(parsed.error) };
  const { error } = await supabase.from("fact_library").upsert({ user_id: user.id, data: parsed.data });
  if (error) return { ok: false, message: "Couldn't save your library." };
  revalidatePath("/library");
  if (next) redirect(next);
  return { ok: true, message: "Saved." };
});

/**
 * The first save (onboarding) fills the years cap and seniority exclusions from the library when the
 * person left them empty. Later saves keep exactly what they set, so they can change or clear these.
 */
async function withLevelDefaults(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, prefs: Preferences): Promise<Preferences> {
  if (prefs.maxYearsRequired != null || prefs.excludeSeniority.length > 0) return prefs;
  const { data: existing } = await supabase.from("preferences").select("user_id").eq("user_id", userId).maybeSingle();
  if (existing) return prefs;
  const { data: facts } = await supabase.from("fact_library").select("data").eq("user_id", userId).maybeSingle();
  const lib = FactLibrarySchema.safeParse(facts?.data);
  if (!lib.success) return prefs;
  const d = levelDefaults(lib.data);
  return { ...prefs, maxYearsRequired: d.maxYearsRequired, excludeSeniority: d.excludeSeniority };
}

export const savePreferences = logged("action.savePreferences", async (input: unknown, next?: string): Promise<ActionResult> => {
  const { supabase, user, profile } = await requireUser();
  if (!profile.consented_at) return { ok: false, message: "Agree to how CV Tailor uses your details first." };
  const parsed = PreferencesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: issuesMessage(parsed.error) };
  const data = await withLevelDefaults(supabase, user.id, parsed.data);
  const { error } = await supabase.from("preferences").upsert({ user_id: user.id, data });
  if (error) return { ok: false, message: "Couldn't save your preferences." };
  await supabase.from("profiles").update({ daily_cap: parsed.data.dailyCap }).eq("id", user.id);
  revalidatePath("/preferences");
  if (next) redirect(next);
  return { ok: true, message: "Saved. Changes apply from the next daily run." };
});

// --- Matches ------------------------------------------------------------------
const STATUSES = ["to_apply", "applied", "interview", "offer", "rejected", "dismissed"];

export const setTrackerStatus = logged("action.setTrackerStatus", async (matchId: number, status: string): Promise<ActionResult> => {
  if (!STATUSES.includes(status)) return { ok: false, message: "Unknown status." };
  const { supabase, user } = await requireUser();
  const { error } = await supabase.from("matches").update({ tracker_status: status }).eq("id", matchId).eq("user_id", user.id);
  revalidatePath("/dashboard");
  return error ? { ok: false, message: "Couldn't update that." } : { ok: true };
});

/** A style for this one CV, or null to follow the user's default. */
export const setMatchCvStyle = logged("action.setMatchCvStyle", async (matchId: number, style: string | null): Promise<ActionResult> => {
  const value = style === null ? null : CvStyle.safeParse(style);
  if (value && !value.success) return { ok: false, message: "Unknown style." };
  const { supabase, user } = await requireUser();
  const { error } = await supabase.from("matches").update({ cv_style: value ? value.data : null }).eq("id", matchId).eq("user_id", user.id);
  revalidatePath("/dashboard");
  return error ? { ok: false, message: "Couldn't change the style." } : { ok: true };
});

// --- Resume versions ------------------------------------------------------------
export const saveResumeVersion = logged("action.saveResumeVersion", async (matchId: number, input: unknown): Promise<ActionResult & { versionId?: number }> => {
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
});

/** "Add to my library" from an editor warning. Adds the term or fact the user confirmed. */
export const addToLibrary = logged("action.addToLibrary", async (addition: { skill?: string; fact?: { text: string; org: string } }): Promise<ActionResult> => {
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
});

// --- Settings ---
export const setCvStyle = logged("action.setCvStyle", async (style: string): Promise<ActionResult> => {
  const parsed = CvStyle.safeParse(style);
  if (!parsed.success) return { ok: false, message: "Unknown style." };
  const { supabase, user } = await requireUser();
  const { error } = await supabase.from("profiles").update({ cv_style: parsed.data }).eq("id", user.id);
  revalidatePath("/settings/cv-style");
  revalidatePath("/dashboard");
  return error ? { ok: false, message: "Couldn't save your CV style." } : { ok: true };
});
/** A4 or US Letter for every CV. Kept with the preferences, where the CV writer reads it. */
export const setPageSize = logged("action.setPageSize", async (size: string): Promise<ActionResult> => {
  if (size !== "A4" && size !== "LETTER") return { ok: false, message: "Unknown paper size." };
  const { supabase, user } = await requireUser();
  const { data } = await supabase.from("preferences").select("data").eq("user_id", user.id).maybeSingle();
  const parsed = PreferencesSchema.safeParse(data?.data);
  if (!parsed.success) return { ok: false, message: "Say what you're looking for first, in Profile." };
  const next = { ...parsed.data, cvTemplate: { ...parsed.data.cvTemplate, pageSize: size } };
  const { error } = await supabase.from("preferences").upsert({ user_id: user.id, data: next });
  if (error) log("preferences.page_size_failed", { userId: user.id, code: bodyErrorCode(error) }, "error");
  revalidatePath("/settings/cv-style");
  return error ? { ok: false, message: "Couldn't save the paper size." } : { ok: true };
});
export const updateSettings = logged("action.updateSettings", async (_prev: ActionResult | null, form: FormData): Promise<ActionResult> => {
  const { supabase, user, profile } = await requireUser();
  const tz = String(form.get("tz") ?? "UTC");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    return { ok: false, message: "That time zone isn't recognised." };
  }
  const notify = String(form.get("notify_email") ?? "").trim();
  if (notify && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(notify)) return { ok: false, message: "That email address doesn't look right." };
  const dailyCap = Number(form.get("daily_cap"));
  if (!Number.isInteger(dailyCap) || dailyCap < 1 || dailyCap > 10) return { ok: false, message: "Most matches per day must be from 1 to 10." };
  const sendTime = String(form.get("send_time") ?? "08:00");
  if (!/^\d{2}:\d{2}/.test(sendTime)) return { ok: false, message: "Enter a send time." };
  const { error } = await supabase
    .from("profiles")
    .update({
      tz,
      send_time: sendTime,
      daily_cap: dailyCap,
      active: form.get("paused") !== "on",
      email_paused: form.get("email_paused") === "on",
    })
    .eq("id", user.id);
  if (error) {
    log("settings.save_failed", { userId: user.id, code: bodyErrorCode(error) }, "error");
    revalidatePath("/settings");
    return { ok: false, message: "Couldn't save your settings." };
  }
  const result = await changeNotifyEmail(user.id, profile, notify);
  revalidatePath("/settings");
  return result;
});

/**
 * A different address for the daily email takes effect only once someone confirms it from that
 * inbox, so the emails can't be pointed at a stranger. Until then they keep going where they went.
 */
async function changeNotifyEmail(userId: string, profile: Profile, requested: string): Promise<ActionResult> {
  const db = adminClient();
  const change = notifyChange(profile, requested);
  const clearPending = { notify_email_pending: null, notify_email_token_hash: null, notify_email_sent_at: null };
  if (change.kind === "use_sign_in" || change.kind === "unchanged") {
    const patch = change.kind === "use_sign_in" ? { notify_email: null, ...clearPending } : clearPending;
    if (profile.notify_email_pending || (change.kind === "use_sign_in" && profile.notify_email)) {
      const { error } = await db.from("profiles").update(patch).eq("id", userId);
      if (error) {
        log("notify_email.clear_failed", { userId, code: bodyErrorCode(error) }, "error");
        return { ok: false, message: "Your settings are saved, but the email address couldn't be changed. Try again." };
      }
    }
    return { ok: true, message: "Saved." };
  }
  if (change.kind === "already_sent") return { ok: true, message: `Saved. We've already sent a link to ${change.to}. Open it to start getting emails there.` };
  if (!allow(`notify-confirm:${userId}`, 5, 60 * 60_000)) return { ok: false, message: "Your settings are saved. You've asked for a lot of confirmation links, so try the new address again in an hour." };
  const { token, hash } = newToken();
  const { error } = await db
    .from("profiles")
    .update({ notify_email_pending: change.to, notify_email_token_hash: hash, notify_email_sent_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) {
    log("notify_email.save_failed", { userId, code: bodyErrorCode(error) }, "error");
    return { ok: false, message: "Your settings are saved, but the new address couldn't be. Try again." };
  }
  const sent = await sendAddressConfirmation(change.to, token);
  if (!sent) {
    log("notify_email.send_failed", { userId }, "error");
    return { ok: false, message: `Your settings are saved, but we couldn't email ${change.to}. Try again shortly.` };
  }
  return { ok: true, message: `Saved. We've sent a link to ${change.to}. Your emails keep going to ${currentAddress(profile)} until you open it.` };
}

/** Drops a new address that hasn't been confirmed. */
export const cancelNotifyChange = logged("action.cancelNotifyChange", async (): Promise<void> => {
  const { user } = await requireUser();
  const { error } = await adminClient().from("profiles").update({ notify_email_pending: null, notify_email_token_hash: null, notify_email_sent_at: null }).eq("id", user.id);
  if (error) log("notify_email.cancel_failed", { userId: user.id, code: bodyErrorCode(error) }, "error");
  revalidatePath("/settings");
});

/** Sends the confirmation link again, with a new token, to the address waiting for it. */
export const resendNotifyConfirm = logged("action.resendNotifyConfirm", async (): Promise<void> => {
  const { user, profile } = await requireUser();
  if (!profile.notify_email_pending) return;
  if (!allow(`notify-confirm:${user.id}`, 5, 60 * 60_000)) redirect("/settings?error=resend");
  const { token, hash } = newToken();
  const { error } = await adminClient().from("profiles").update({ notify_email_token_hash: hash, notify_email_sent_at: new Date().toISOString() }).eq("id", user.id);
  if (error) {
    log("notify_email.resend_failed", { userId: user.id, code: bodyErrorCode(error) }, "error");
    redirect("/settings?error=resend");
  }
  const sent = await sendAddressConfirmation(profile.notify_email_pending, token);
  if (!sent) log("notify_email.send_failed", { userId: user.id }, "error");
  redirect(sent ? "/settings?resent=1" : "/settings?error=resend");
});

// --- Admin ----------------------------------------------------------------------
export const allowEmail = logged("action.allowEmail", async (form: FormData): Promise<void> => {
  await requireAdmin();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!email.includes("@")) return;
  await adminClient().from("allowed_emails").upsert({ email, note: String(form.get("note") ?? "") || null });
  revalidatePath("/admin");
});

export const removeEmail = logged("action.removeEmail", async (form: FormData): Promise<void> => {
  await requireAdmin();
  await adminClient().from("allowed_emails").delete().eq("email", String(form.get("email")));
  revalidatePath("/admin");
});

/** Lets someone from the waitlist sign up, and tells them. A failed email doesn't undo the invitation. */
export const inviteFromWaitlist = logged("action.inviteFromWaitlist", async (form: FormData): Promise<void> => {
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
});

export const removeFromWaitlist = logged("action.removeFromWaitlist", async (form: FormData): Promise<void> => {
  await requireAdmin();
  await adminClient().from("waitlist").delete().eq("email", String(form.get("email")));
  revalidatePath("/admin");
});

export const setKillSwitch = logged("action.setKillSwitch", async (form: FormData): Promise<void> => {
  await requireAdmin();
  await adminClient().from("app_settings").update({ value: form.get("on") === "true" }).eq("key", "kill_switch");
  revalidatePath("/admin");
});
