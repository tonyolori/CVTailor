import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../config";
import { must, serviceClient } from "../db";

/** Seeds `companies` from the committed data file: public company names and boards, nothing personal. */
const DATA = join(import.meta.dirname, "../../data/companies.json");

interface CompanySeed {
  ats: string;
  slug: string;
  name?: string;
  notes?: string;
  tags: string[];
  countries: string[];
}

const rows = JSON.parse(readFileSync(DATA, "utf8")) as CompanySeed[];
const db = serviceClient(loadConfig());
must(await db.from("companies").upsert(rows, { onConflict: "ats,slug", ignoreDuplicates: true }), "seed companies");
const counts = rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.ats]: (acc[r.ats] ?? 0) + 1 }), {});
console.log(`seeded ${rows.length} companies`, counts);
