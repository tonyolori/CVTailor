import { cvStyleOf, FactLibrarySchema, PreferencesSchema, type CvStyle, type FactLibrary, type Preferences } from "@cvtailor/core";
import { must, type Db } from "./db";
import { log } from "./log";

export interface ActiveUser {
  id: string;
  email: string;
  notifyEmail: string;
  displayName: string | null;
  tz: string;
  sendTime: string;
  dailyCap: number;
  isSynthetic: boolean;
  plan: string;
  paidUntil: string | null;
  emailPaused: boolean;
  unsubscribeToken: string;
  cvStyle: CvStyle;
  preferences: Preferences;
  preferencesVersion: number;
  facts: FactLibrary;
}

interface ProfileRow {
  id: string;
  email: string;
  notify_email: string | null;
  display_name: string | null;
  tz: string;
  send_time: string;
  daily_cap: number;
  active: boolean;
  is_synthetic: boolean;
  plan: string;
  paid_until: string | null;
  email_paused: boolean;
  unsubscribe_token: string;
  cv_style: string | null;
}

/** Users who are not paused and have finished onboarding. Invalid data skips that user, not the run. */
export async function loadActiveUsers(db: Db): Promise<ActiveUser[]> {
  return usersFrom(db, must(await db.from("profiles").select("*").eq("active", true), "load profiles") as ProfileRow[]);
}

/** One user with finished onboarding, paused or not. A CV someone asks for doesn't depend on the daily search. */
export async function loadUser(db: Db, id: string): Promise<ActiveUser | null> {
  const users = await usersFrom(db, must(await db.from("profiles").select("*").eq("id", id), "load profile") as ProfileRow[]);
  return users[0] ?? null;
}

async function usersFrom(db: Db, profiles: ProfileRow[]): Promise<ActiveUser[]> {
  const ids = profiles.map((p) => p.id);
  if (ids.length === 0) return [];
  const prefs = must(await db.from("preferences").select("user_id,data,version").in("user_id", ids), "load preferences") as {
    user_id: string;
    data: unknown;
    version: number;
  }[];
  const facts = must(await db.from("fact_library").select("user_id,data").in("user_id", ids), "load facts") as {
    user_id: string;
    data: unknown;
  }[];
  const prefById = new Map(prefs.map((p) => [p.user_id, p]));
  const factsById = new Map(facts.map((f) => [f.user_id, f]));

  const users: ActiveUser[] = [];
  for (const p of profiles) {
    const pref = prefById.get(p.id);
    const fact = factsById.get(p.id);
    if (!pref || !fact) continue;
    const parsedPrefs = PreferencesSchema.safeParse(pref.data);
    const parsedFacts = FactLibrarySchema.safeParse(fact.data);
    if (!parsedPrefs.success || !parsedFacts.success) {
      log("users.invalid_data", { userId: p.id, prefsOk: parsedPrefs.success, factsOk: parsedFacts.success });
      continue;
    }
    users.push({
      id: p.id,
      email: p.email,
      notifyEmail: p.notify_email ?? p.email,
      displayName: p.display_name,
      tz: p.tz,
      sendTime: p.send_time,
      dailyCap: p.daily_cap,
      isSynthetic: p.is_synthetic,
      plan: p.plan,
      paidUntil: p.paid_until,
      emailPaused: p.email_paused,
      unsubscribeToken: p.unsubscribe_token,
      cvStyle: cvStyleOf(p.cv_style),
      preferences: parsedPrefs.data,
      preferencesVersion: pref.version,
      facts: parsedFacts.data,
    });
  }
  return users;
}
