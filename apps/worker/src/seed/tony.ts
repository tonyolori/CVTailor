import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FactLibrarySchema, PreferencesSchema } from "@jobtailor/core";
import { loadConfig } from "../config";
import { serviceClient } from "../db";
import { parseProject, parseWorkExperiences } from "./parse-library";
import { upsertUser } from "./users";

/**
 * Seeds the owner as user #1 from legacy/. Everything personal stays in gitignored paths:
 * the inputs in legacy/ and legacy/seed/owner.json, the output in .local/review/.
 * Pass --write to save to the database. Without it, this only writes the review files.
 */
const ROOT = join(import.meta.dirname, "../../../..");
const LIB = join(ROOT, "legacy/lib");
const seed = JSON.parse(readFileSync(join(ROOT, "legacy/seed/owner.json"), "utf8"));

const work = parseWorkExperiences(readFileSync(join(LIB, "work-experiences/workExperiences.md"), "utf8"));
const projects = readdirSync(join(LIB, "projects")).map((f) => parseProject(readFileSync(join(LIB, "projects", f), "utf8")));

const entries = [...work.entries, ...projects.flatMap((p) => p.entries), ...seed.education];
for (const e of entries) {
  const extra = seed.doNotClaimByOrg?.[e.org];
  if (extra && e.kind === "role") e.doNotClaim = [...new Set([...e.doNotClaim, ...extra])];
}

const facts = FactLibrarySchema.parse({
  contact: seed.contact,
  entries,
  skills: [...new Set([...work.skills, ...projects.flatMap((p) => p.skills)])],
  credentials: seed.credentials ?? [],
  languages: seed.languages ?? [],
  portfolioLinks: seed.portfolioLinks ?? [],
});
const preferences = PreferencesSchema.parse(seed.preferences);

const out = join(ROOT, ".local/review");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "owner-facts.json"), JSON.stringify(facts, null, 2));
writeFileSync(join(out, "owner-preferences.json"), JSON.stringify(preferences, null, 2));
const factCount = facts.entries.reduce((n, e) => n + e.facts.length, 0);
const variantCount = facts.entries.reduce((n, e) => n + e.variants.length, 0);
const capacity = facts.entries.reduce((n, e) => n + e.facts.filter((f) => f.designCapacity).length, 0);
console.log(
  `entries=${facts.entries.length} facts=${factCount} variants=${variantCount} designCapacity=${capacity} ` +
    `skills=${facts.skills.length} doNotClaim=${facts.entries.reduce((n, e) => n + e.doNotClaim.length, 0)}`,
);
console.log(`review files written to ${out}`);

if (process.argv.includes("--write")) {
  const id = await upsertUser(serviceClient(loadConfig()), {
    email: seed.accountEmail,
    displayName: seed.contact.name,
    tz: seed.tz,
    isSynthetic: false,
    notifyEmail: seed.notifyEmail,
    preferences,
    facts,
  });
  console.log(`seeded owner (${id})`);
}
