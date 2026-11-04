import { prefilter, type Category, type Preferences } from "@cvtailor/core";
import { chunks, must, type Db } from "../db";
import { log } from "../log";
import { atsBoards, scanCompanies, type CompanyRow } from "../sources/ats";
import type { Http } from "../sources/http";
import { relevantAdapters, relevantCompanies, searchQueries, type RegistryOptions } from "../sources/registry";
import { dedupeKey } from "../sources/text";
import type { RawJob } from "../sources/types";
import { AGGREGATORS } from "../sources/aggregators";

/** Two failures in a row and a board moves back to the leads list. */
export const MAX_BOARD_FAILURES = 2;
const MAX_DESCRIPTION_CHARS = 30_000;
const INSERT_CHUNK = 200;

export interface CollectResult {
  sources: { id: string; label: string; found: number; failed: boolean }[];
  fetched: number;
  kept: number;
  inserted: number;
  droppedByFilter: Record<string, number>;
}

/** Cut at a paragraph boundary. Structured location fields are stored separately, so they're never lost. */
export function capDescription(text: string): string {
  if (text.length <= MAX_DESCRIPTION_CHARS) return text;
  const cut = text.lastIndexOf("\n", MAX_DESCRIPTION_CHARS);
  return text.slice(0, cut > 0 ? cut : MAX_DESCRIPTION_CHARS);
}

export function toJobRow(j: RawJob) {
  return {
    url: j.url,
    apply_url: j.applyUrl,
    company: j.company,
    title: j.title,
    source: j.source,
    posted_at: j.postedAt,
    ats_posted_at: j.fromAts ? j.postedAt : null,
    from_ats: j.fromAts,
    raw_text: capDescription(j.description),
    location_text: j.locationText,
    work_mode: j.workModeHint,
    country: j.country,
    ats_fields: j.atsFields,
    dedupe_key: dedupeKey(j.company, j.title),
  };
}

/** Same posting from several sources: the employer's own board wins, because its date and locations are authoritative. */
export function dedupeRun(jobs: RawJob[]): RawJob[] {
  const byUrl = new Map<string, RawJob>();
  for (const j of jobs) if (!byUrl.has(j.url)) byUrl.set(j.url, j);
  const out: RawJob[] = [];
  const aggregatorSeen = new Set<string>();
  const atsKeys = new Set([...byUrl.values()].filter((j) => j.fromAts).map((j) => dedupeKey(j.company, j.title)));
  for (const j of byUrl.values()) {
    const key = dedupeKey(j.company, j.title);
    if (j.fromAts) {
      out.push(j);
    } else if (!atsKeys.has(key) && !aggregatorSeen.has(key)) {
      aggregatorSeen.add(key);
      out.push(j);
    }
  }
  return out;
}

/** Two failures in a row returns a board to the leads list, keeping its old address in the notes. */
export async function recordBoardOutcomes(db: Db, companies: CompanyRow[], outcomes: { companyId: number; ok: boolean }[]): Promise<void> {
  const byId = new Map(companies.map((c) => [c.id, c]));
  const now = new Date().toISOString();
  for (const o of outcomes) {
    const c = byId.get(o.companyId);
    if (!c) continue;
    if (o.ok) {
      if (c.fail_count > 0) must(await db.from("companies").update({ fail_count: 0, last_ok: now }).eq("id", c.id), "board ok");
      else must(await db.from("companies").update({ last_ok: now }).eq("id", c.id), "board ok");
      continue;
    }
    const failures = c.fail_count + 1;
    if (failures >= MAX_BOARD_FAILURES) {
      log("board.moved_to_lead", { companyId: c.id, ats: c.ats, slug: c.slug });
      must(
        await db
          .from("companies")
          .update({ ats: "lead", slug: `${c.ats}:${c.slug}`, fail_count: failures, last_failure_at: now, notes: `Board stopped responding on ${now.slice(0, 10)}` })
          .eq("id", c.id),
        "board to lead",
      );
    } else {
      must(await db.from("companies").update({ fail_count: failures, last_failure_at: now }).eq("id", c.id), "board fail");
    }
  }
}

export async function collect(
  db: Db,
  http: Http,
  users: Preferences[],
  categories: Category[],
  opts: RegistryOptions,
  now: Date = new Date(),
): Promise<CollectResult> {
  const adapters = relevantAdapters(users, opts, AGGREGATORS);
  const queries = searchQueries(users);
  const ctx = { http, queries, now };
  const sources: CollectResult["sources"] = [];
  const raw: RawJob[] = [];

  for (const adapter of adapters) {
    try {
      const jobs = await adapter.fetch(ctx);
      raw.push(...jobs);
      sources.push({ id: adapter.id, label: adapter.label, found: jobs.length, failed: false });
      log("collect.source", { source: adapter.id, found: jobs.length });
    } catch (err) {
      sources.push({ id: adapter.id, label: adapter.label, found: 0, failed: true });
      log("collect.source_failed", { source: adapter.id, kind: err instanceof Error ? err.name : "unknown" });
    }
  }

  const companies = must(
    await db.from("companies").select("id,ats,slug,name,tags,countries,fail_count").in("ats", ["gh", "lever", "ashby", "workable", "breezy", "recruitee"]),
    "load companies",
  ) as CompanyRow[];
  const boards = relevantCompanies(companies, users);
  const scan = await scanCompanies(http, boards);
  raw.push(...scan.jobs);
  await recordBoardOutcomes(db, boards, scan.outcomes);
  sources.push({ id: atsBoards.id, label: atsBoards.label, found: scan.jobs.length, failed: false });
  log("collect.boards", { boards: boards.length, failed: scan.outcomes.filter((o) => !o.ok).length, found: scan.jobs.length });

  // Pre-filter first: postings nobody could want are never stored or enriched.
  const droppedByFilter: Record<string, number> = {};
  const kept = raw.filter((j) => {
    const r = prefilter(
      { title: j.title, locationText: j.locationText, workModeHint: j.workModeHint, postedAt: j.postedAt },
      users,
      categories,
      now,
    );
    if (!r.keep && r.reason) droppedByFilter[r.reason] = (droppedByFilter[r.reason] ?? 0) + 1;
    return r.keep;
  });

  const unique = dedupeRun(kept);
  const inserted = await storeJobs(db, unique);
  log("collect.done", { fetched: raw.length, kept: unique.length, inserted });
  return { sources, fetched: raw.length, kept: unique.length, inserted, droppedByFilter };
}

/** Inserts new postings only: a URL already stored is never re-processed, only marked as still listed. */
export async function storeJobs(db: Db, jobs: RawJob[]): Promise<number> {
  const knownUrls = new Set<string>();
  const knownKeys = new Set<string | null>();
  for (const batch of chunks([...new Set(jobs.map((j) => j.url))])) {
    const rows = must(await db.from("jobs").select("url").in("url", batch), "existing urls") as { url: string }[];
    rows.forEach((r) => knownUrls.add(r.url));
  }
  for (const batch of chunks([...new Set(jobs.map((j) => dedupeKey(j.company, j.title)))])) {
    const rows = must(await db.from("jobs").select("dedupe_key").in("dedupe_key", batch), "existing keys") as { dedupe_key: string | null }[];
    rows.forEach((r) => knownKeys.add(r.dedupe_key));
  }

  const fresh = jobs.filter((j) => !knownUrls.has(j.url) && (j.fromAts || !knownKeys.has(dedupeKey(j.company, j.title))));
  let inserted = 0;
  for (const batch of chunks(fresh, INSERT_CHUNK)) {
    const rows = must(await db.from("jobs").upsert(batch.map(toJobRow), { onConflict: "url", ignoreDuplicates: true }).select("id"), "insert jobs") as { id: number }[];
    inserted += rows.length;
  }

  const nowIso = new Date().toISOString();
  for (const batch of chunks(jobs.filter((j) => knownUrls.has(j.url)).map((j) => j.url))) {
    must(await db.from("jobs").update({ last_seen: nowIso }).in("url", batch), "mark seen");
  }
  return inserted;
}
