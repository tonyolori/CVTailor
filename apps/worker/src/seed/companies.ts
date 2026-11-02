import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../config";
import { must, serviceClient } from "../db";

/**
 * Seeds `companies`. The committed data file is generated once from the legacy watch list
 * (`--from-legacy`). It holds public company names and boards only, nothing personal.
 */
const ROOT = join(import.meta.dirname, "../../../..");
const DATA = join(import.meta.dirname, "../../data/companies.json");

interface CompanySeed {
  ats: string;
  slug: string;
  name?: string;
  notes?: string;
  tags: string[];
  countries: string[];
}

/** The legacy list is tech employers only. Other categories grow their own lists. */
const LEGACY_TAGS = ["tech", "software-engineering", "data-ai"];

export function parseWatchList(md: string): CompanySeed[] {
  const section = (name: string) => md.split(new RegExp(`^## ${name}\\s*$`, "m"))[1]?.split(/^## /m)[0] ?? "";
  const notes = [...section("Notes").matchAll(/^- \*\*(.+?)\*\*[:\s]*(.+)$/gm)].map((m) => ({ who: m[1]!, text: m[2]! }));
  const noteFor = (slug: string) =>
    notes.find((n) => {
      const who = n.who.toLowerCase().replace(/[^a-z0-9]/g, "");
      return who.length > 2 && slug.toLowerCase().replace(/[^a-z0-9]/g, "").includes(who);
    })?.text;

  const out: CompanySeed[] = [];
  for (const m of section("Watch list").matchAll(/^(gh|lever|ashby|workable|breezy|recruitee) (\S+)\s*$/gm)) {
    out.push({ ats: m[1]!, slug: m[2]!, notes: noteFor(m[2]!), tags: LEGACY_TAGS, countries: [] });
  }
  for (const m of section("Careers pages").matchAll(/^page (\S+)\s*$/gm)) {
    out.push({ ats: "page", slug: m[1]!, tags: LEGACY_TAGS, countries: [] });
  }
  for (const m of section("Leads").matchAll(/^lead (.+?) – (.+)$/gm)) {
    out.push({ ats: "lead", slug: m[1]!, name: m[1]!, notes: m[2]!, tags: LEGACY_TAGS, countries: [] });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes("--from-legacy")) {
    const legacy = join(ROOT, "legacy/job-search/companies.md");
    if (!existsSync(legacy)) throw new Error("legacy/job-search/companies.md not found");
    const rows = parseWatchList(readFileSync(legacy, "utf8"));
    writeFileSync(DATA, JSON.stringify(rows, null, 1) + "\n");
    console.log(`wrote ${rows.length} companies to data/companies.json`);
  }
  const rows = JSON.parse(readFileSync(DATA, "utf8")) as CompanySeed[];
  const db = serviceClient(loadConfig());
  must(await db.from("companies").upsert(rows, { onConflict: "ats,slug", ignoreDuplicates: true }), "seed companies");
  const counts = rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.ats]: (acc[r.ats] ?? 0) + 1 }), {});
  console.log(`seeded ${rows.length} companies`, counts);
}
