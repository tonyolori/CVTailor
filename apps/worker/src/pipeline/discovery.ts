import { must, type Db } from "../db";
import { log } from "../log";
import { ATS_KINDS, scanBoard, type AtsKind, type CompanyRow } from "../sources/ats";
import type { Http } from "../sources/http";

const WEEK_MS = 7 * 86_400_000;
const MAX_PROBES_PER_RUN = 40;

export function slugCandidates(company: string): string[] {
  const words = company
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|gmbh|limited|corp|co|plc)\b\.?/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return [];
  // Never the first word alone: "Bright Vision Technologies" matched a board called "bright",
  // which belongs to some other company.
  return [...new Set([words.join(""), words.join("-")])];
}

/**
 * Weekly: harvest companies behind aggregator hits and probe their public boards, one at a
 * time. Adds rows only; no LLM. A company is tagged with the categories it was found under.
 */
export async function runDiscovery(db: Db, http: Http, now: Date = new Date()): Promise<{ probed: number; added: number } | null> {
  const last = must(await db.from("app_settings").select("value").eq("key", "last_discovery_at").single(), "last discovery") as { value: string | null };
  if (last.value && now.getTime() - new Date(last.value).getTime() < WEEK_MS) return null;

  const since = new Date(now.getTime() - WEEK_MS).toISOString();
  const jobs = must(
    await db.from("jobs").select("company,category,country").eq("from_ats", false).is("owner_id", null).gte("first_seen", since).limit(500),
    "recent jobs",
  ) as { company: string; category: string | null; country: string | null }[];
  const known = must(await db.from("companies").select("ats,slug,name").limit(5000), "known companies") as { ats: string; slug: string; name: string | null }[];
  const knownSlugs = new Set(known.map((k) => k.slug.toLowerCase()));
  const knownNames = new Set(known.map((k) => (k.name ?? "").toLowerCase()));

  let probed = 0;
  let added = 0;
  const seen = new Set<string>();
  outer: for (const job of jobs) {
    const name = job.company.trim();
    const lower = name.toLowerCase();
    if (!name || seen.has(lower) || knownNames.has(lower)) continue;
    seen.add(lower);
    for (const slug of slugCandidates(name)) {
      if (knownSlugs.has(slug)) continue;
      for (const ats of ATS_KINDS) {
        if (probed >= MAX_PROBES_PER_RUN) break outer;
        probed++;
        if (await isLiveBoard(http, ats, slug)) {
          must(
            await db.from("companies").upsert(
              {
                ats,
                slug,
                name,
                tags: job.category && job.category !== "other" ? [job.category] : [],
                countries: job.country ? [job.country] : [],
                notes: `Found by discovery on ${now.toISOString().slice(0, 10)}`,
              },
              { onConflict: "ats,slug", ignoreDuplicates: true },
            ),
            "add company",
          );
          knownSlugs.add(slug);
          added++;
          continue outer;
        }
      }
    }
  }
  must(await db.from("app_settings").update({ value: now.toISOString() }).eq("key", "last_discovery_at"), "discovery time");
  log("discovery.done", { probed, added });
  return { probed, added };
}

async function isLiveBoard(http: Http, ats: AtsKind, slug: string): Promise<boolean> {
  const company: CompanyRow = { id: 0, ats, slug, tags: [], countries: [], fail_count: 0 };
  const jobs = await scanBoard(http, company);
  return jobs != null && jobs.length > 0;
}
