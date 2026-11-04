import { PERSONAS } from "@cvtailor/core";
import { loadConfig } from "../config";
import { must, serviceClient } from "../db";
import { upsertUser } from "./users";

const db = serviceClient(loadConfig());
for (const p of PERSONAS) {
  const id = await upsertUser(db, {
    email: p.email,
    displayName: p.displayName,
    tz: p.tz,
    isSynthetic: true,
    preferences: p.preferences,
    facts: p.facts,
  });
  console.log(`seeded persona ${p.key} (${id})`);
}

/**
 * A blank account for trying signup as a new user: consent, CV upload, preferences. It's synthetic
 * so AI steps run in subscription mode, where other accounts are refused. Re-seeding starts it over.
 */
const BLANK = "newuser@cvtailor.test";
const existing = must(await db.from("profiles").select("id").eq("email", BLANK).maybeSingle(), "find blank user");
if (existing) {
  const removed = await db.auth.admin.deleteUser(existing.id);
  if (removed.error) throw new Error(`reset blank user: ${removed.error.message}`);
}
must(await db.from("allowed_emails").upsert({ email: BLANK, note: "blank account for testing signup" }), "allow blank user");
const created = await db.auth.admin.createUser({ email: BLANK, email_confirm: true });
if (created.error || !created.data.user) throw new Error(`create blank user: ${created.error?.message}`);
must(await db.from("profiles").update({ is_synthetic: true }).eq("id", created.data.user.id), "mark blank user");
console.log(`seeded blank account ${BLANK}`);
