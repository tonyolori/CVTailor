import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FactLibrarySchema, PreferencesSchema } from "@cvtailor/core";
import { z } from "zod";
import { loadConfig } from "../config";
import { must, serviceClient } from "../db";

/**
 * Puts the owner's preferences and fact library from private/owner.json onto their existing live
 * account, and sets its time zone. Nothing else on the account changes: no new user, no consent,
 * email or plan changes. What was there before is saved under .local/ first (gitignored).
 *
 *   npm run seed:tony:live -- --dry-run   shows what would change
 *   npm run seed:tony:live                writes it
 *
 * Preferences and library versions bump on update, so the next run scores everything afresh.
 */
const OwnerSchema = z.object({
  accountEmail: z.string().email(),
  tz: z.string().min(1),
  preferences: PreferencesSchema,
  facts: FactLibrarySchema,
});

const dryRun = process.argv.includes("--dry-run");
const path = join(import.meta.dirname, "../../../../private/owner.json");
if (!existsSync(path)) {
  console.log("private/owner.json not found: nothing to do");
  process.exit(0);
}
const owner = OwnerSchema.parse(JSON.parse(readFileSync(path, "utf8")));
const db = serviceClient(loadConfig());

const profile = must(await db.from("profiles").select("id,tz").eq("email", owner.accountEmail.toLowerCase()).maybeSingle(), "find owner") as { id: string; tz: string } | null;
if (!profile) {
  console.log("The owner has no account on this database yet. Sign in once first; this never creates one.");
  process.exit(1);
}
const [prefs, facts] = await Promise.all([
  db.from("preferences").select("data,version").eq("user_id", profile.id).maybeSingle(),
  db.from("fact_library").select("data,version").eq("user_id", profile.id).maybeSingle(),
]);
const before = { tz: profile.tz, preferences: prefs.data, facts: facts.data };
const count = (lib: { entries?: unknown[]; skills?: unknown[] } | undefined) => `${lib?.entries?.length ?? 0} entries, ${lib?.skills?.length ?? 0} skills`;
const p = (prefs.data?.data ?? {}) as { targetTitles?: string[] };

console.log(`time zone: ${profile.tz} -> ${owner.tz}`);
console.log(`target titles: ${p.targetTitles?.length ?? 0} -> ${owner.preferences.targetTitles.length}; search topics -> ${owner.preferences.searchTopics.length}`);
console.log(`library: ${count(facts.data?.data as never)} -> ${count(owner.facts)}`);
if (dryRun) {
  console.log("dry run: nothing written");
  process.exit(0);
}

const backupDir = join(import.meta.dirname, "../../../../.local");
mkdirSync(backupDir, { recursive: true });
const backup = join(backupDir, `owner-live-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(backup, JSON.stringify(before, null, 2));

must(await db.from("preferences").upsert({ user_id: profile.id, data: owner.preferences }), "preferences");
must(await db.from("fact_library").upsert({ user_id: profile.id, data: owner.facts }), "facts");
must(await db.from("profiles").update({ tz: owner.tz, daily_cap: owner.preferences.dailyCap }).eq("id", profile.id), "profile");
console.log(`written. The previous values are in ${backup}`);
