import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FactLibrarySchema, PreferencesSchema } from "@jobtailor/core";
import { z } from "zod";
import { loadConfig } from "../config";
import { serviceClient } from "../db";
import { upsertUser } from "./users";

/**
 * Seeds the owner as user #1 from private/owner.json. That file is gitignored because it holds
 * real CV facts and contact details, so edit it directly and re-run this. Safe to re-run.
 */
const OwnerSeedSchema = z.object({
  accountEmail: z.string().email(),
  notifyEmail: z.string().email().optional(),
  displayName: z.string().min(1),
  tz: z.string().min(1),
  preferences: PreferencesSchema,
  facts: FactLibrarySchema,
});

const path = join(import.meta.dirname, "../../../../private/owner.json");
if (!existsSync(path)) {
  console.log("private/owner.json not found: skipping the owner");
  process.exit(0);
}

const seed = OwnerSeedSchema.parse(JSON.parse(readFileSync(path, "utf8")));
const id = await upsertUser(serviceClient(loadConfig()), {
  email: seed.accountEmail,
  displayName: seed.displayName,
  tz: seed.tz,
  isSynthetic: false,
  notifyEmail: seed.notifyEmail,
  preferences: seed.preferences,
  facts: seed.facts,
});
const facts = seed.facts.entries.reduce((n, e) => n + e.facts.length, 0);
console.log(`seeded owner (${id}): entries=${seed.facts.entries.length} facts=${facts} skills=${seed.facts.skills.length}`);
