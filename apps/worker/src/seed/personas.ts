import { PERSONAS } from "@jobtailor/core";
import { loadConfig } from "../config";
import { serviceClient } from "../db";
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
