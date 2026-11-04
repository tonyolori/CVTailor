import { FactLibrarySchema, PreferencesSchema, type FactLibrary, type Preferences } from "@cvtailor/core";
import { must, type Db } from "../db";

export interface SeedUser {
  email: string;
  displayName: string;
  tz: string;
  isSynthetic: boolean;
  notifyEmail?: string;
  preferences: Preferences;
  facts: FactLibrary;
}

/** Create or update one user with validated preferences and facts. Safe to re-run. */
export async function upsertUser(db: Db, u: SeedUser): Promise<string> {
  const preferences = PreferencesSchema.parse(u.preferences);
  const facts = FactLibrarySchema.parse(u.facts);
  const email = u.email.toLowerCase();

  must(await db.from("allowed_emails").upsert({ email, note: u.isSynthetic ? "synthetic persona" : "seeded" }), "allow-list");

  let id = await findUserId(db, email);
  if (!id) {
    const created = await db.auth.admin.createUser({ email, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(`create user: ${created.error?.message}`);
    id = created.data.user.id;
  }

  must(
    await db
      .from("profiles")
      .update({
        display_name: u.displayName,
        tz: u.tz,
        is_synthetic: u.isSynthetic,
        notify_email: u.notifyEmail ?? null,
        daily_cap: preferences.dailyCap,
        consented_at: new Date().toISOString(),
      })
      .eq("id", id),
    "profile",
  );
  must(await db.from("preferences").upsert({ user_id: id, data: preferences }), "preferences");
  must(await db.from("fact_library").upsert({ user_id: id, data: facts }), "facts");
  return id;
}

async function findUserId(db: Db, email: string): Promise<string | null> {
  const row = must(await db.from("profiles").select("id").eq("email", email).maybeSingle(), "find user");
  return row?.id ?? null;
}
