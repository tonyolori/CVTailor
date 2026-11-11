import { titleTier, type Category, type Preferences, type TitleTier } from "@cvtailor/core";
import { addUsage, ZERO_USAGE, type LlmProvider, type LlmUsage } from "@cvtailor/llm";
import { BudgetExceeded, type Budget } from "@cvtailor/ai/budget";
import { buildEnrichRequest, reconcile, type JobRow } from "@cvtailor/ai/enrich";
import { chunks, must, type Db } from "../db";
import { log } from "../log";
import type { Http } from "../sources/http";
import { checkLive, type LiveCheck } from "./live";

export type { JobRow };

export function needsLiveCheck(job: JobRow): boolean {
  // The employer's own board was read minutes ago, unless it gave no description (Breezy).
  return !job.from_ats || !job.raw_text?.trim();
}

/** The page to verify. An aggregator's apply link usually leads to the employer's ATS. */
export function liveUrl(job: JobRow): string {
  return job.apply_url && /^https?:/.test(job.apply_url) ? job.apply_url : job.url;
}

export interface EnrichResult {
  enriched: number;
  failed: number;
  stoppedBy?: string;
  usage: LlmUsage;
}

const WORLDWIDE_HINT = /\b(worldwide|anywhere|global|work from anywhere)\b/i;
const TIER_RANK: Record<TitleTier, number> = { core: 0, a: 1, b: 2, c: 3 };

interface PendingJob {
  id: number;
  title: string;
  location_text: string | null;
  from_ats: boolean;
  posted_at: string | null;
}

/**
 * Lower is sooner. A job close to someone's main titles goes first, then one labelled worldwide or
 * read from an employer's own board. With a capped run, this decides what gets looked at today.
 */
export function enrichPriority(job: Pick<PendingJob, "title" | "location_text" | "from_ats">, users: Preferences[]): number {
  let best = 4;
  for (const u of users) {
    const t = titleTier(job.title, u);
    if (t) best = Math.min(best, TIER_RANK[t]);
  }
  return best - (WORLDWIDE_HINT.test(job.location_text ?? "") ? 0.5 : 0) - (job.from_ats ? 0.25 : 0);
}

/** Picks today's batch from the backlog, best first, and retires postings already too old for everyone. */
async function pendingBatch(db: Db, users: Preferences[], maxPerRun: number, now: Date): Promise<JobRow[]> {
  const pending = must(
    await db.from("jobs").select("id,title,location_text,from_ats,posted_at").eq("status", "new").is("owner_id", null).order("posted_at", { ascending: false, nullsFirst: false }).limit(5000),
    "pending jobs",
  ) as PendingJob[];

  const maxAge = users.length > 0 ? Math.max(...users.map((u) => u.maxPostingAgeDays)) : Infinity;
  const tooOld = pending.filter((j) => j.posted_at && (now.getTime() - new Date(j.posted_at).getTime()) / 86_400_000 > maxAge);
  for (const ids of chunks(tooOld.map((j) => j.id), 200)) {
    must(await db.from("jobs").update({ status: "filtered", filter_reason: "age" }).in("id", ids), "retire old jobs");
  }
  const old = new Set(tooOld.map((j) => j.id));
  const time = (j: PendingJob) => (j.posted_at ? new Date(j.posted_at).getTime() : 0);
  const chosen = pending
    .filter((j) => !old.has(j.id))
    .map((j) => ({ j, p: enrichPriority(j, users) }))
    .sort((a, b) => a.p - b.p || time(b.j) - time(a.j))
    .slice(0, maxPerRun)
    .map((x) => x.j.id);

  const rows: JobRow[] = [];
  for (const ids of chunks(chosen, 200)) {
    rows.push(...(must(await db.from("jobs").select("*").in("id", ids), "batch jobs") as JobRow[]));
  }
  const order = new Map(chosen.map((id, i) => [id, i]));
  log("enrich.batch", { pending: pending.length, retired: tooOld.length, chosen: rows.length });
  return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/**
 * Each posting is enriched once and shared by all users. Failures don't stop the rest. What isn't
 * reached today stays 'new' and is ranked again tomorrow.
 */
export async function enrichPending(
  db: Db,
  http: Http,
  provider: LlmProvider,
  budget: Budget,
  categories: Category[],
  maxPerRun = 300,
  users: Preferences[] = [],
  now: Date = new Date(),
): Promise<EnrichResult> {
  const jobs = await pendingBatch(db, users, maxPerRun, now);
  let usage = ZERO_USAGE;
  let enriched = 0;
  let failed = 0;
  if (jobs.length === 0) return { enriched, failed, usage };

  try {
    budget.assertAvailable();
  } catch (err) {
    if (err instanceof BudgetExceeded) return { enriched, failed, stoppedBy: err.scope, usage };
    throw err;
  }

  const lives = new Map<number, LiveCheck | null>();
  for (const job of jobs) lives.set(job.id, needsLiveCheck(job) ? await checkLive(http, liveUrl(job)) : null);

  const ids = new Set(categories.map((c) => c.id));
  const requests = jobs.map((j) => buildEnrichRequest(j, lives.get(j.id) ?? null, categories));

  // In sequence on a plan, in a batch on the API. Either way one stop point per chunk,
  // so the budget is checked as the stage runs instead of only at the start.
  const CHUNK = provider.name === "anthropic-api" ? 100 : 10;
  let stoppedBy: string | undefined;
  for (let i = 0; i < requests.length; i += CHUNK) {
    try {
      budget.assertAvailable();
    } catch (err) {
      if (err instanceof BudgetExceeded) {
        stoppedBy = err.scope;
        break;
      }
      throw err;
    }
    const results = await provider.completeMany(requests.slice(i, i + CHUNK));
    for (const job of jobs.slice(i, i + CHUNK)) {
      const r = results.get(String(job.id));
      if (!r) continue;
      usage = addUsage(usage, r.usage);
      budget.add(r.usage.costUsd);
      if (!r.ok) {
        if (r.kind === "rate_limit" || r.kind === "auth") {
          stoppedBy = r.kind;
          continue; // Stays 'new' for the next run.
        }
        failed++;
        log("enrich.failed", { jobId: job.id, kind: r.kind });
        must(await db.from("jobs").update({ status: "failed", filter_reason: r.kind }).eq("id", job.id), "mark failed");
        continue;
      }
      const live = lives.get(job.id) ?? null;
      const e = reconcile(r.data, job, live, ids);
      if (e.category === "other" && r.data.category !== "other") await noteUnknownCategory(db, r.data.category, job.id);
      must(
        await db
          .from("jobs")
          .update({
            enriched: e,
            status: e.isOpen ? (job.from_ats || live?.reachable ? "verified" : "enriched") : "closed",
            category: e.category,
            country: e.locations[0]?.country ?? e.eligibleCountries[0] ?? null,
            work_mode: e.workMode,
            posted_at: e.postedAt,
            last_verified: job.from_ats || live?.reachable ? new Date().toISOString() : null,
          })
          .eq("id", job.id),
        "store enrichment",
      );
      enriched++;
    }
    if (stoppedBy) break;
  }
  await budget.record("enrich", usage, stoppedBy ? "failed" : "ok", null, stoppedBy ?? null);
  log("enrich.done", { enriched, failed, stoppedBy, calls: usage.calls, costUsd: usage.costUsd });
  return { enriched, failed, stoppedBy, usage };
}

async function noteUnknownCategory(db: Db, raw: string, jobId: number): Promise<void> {
  const key = raw.slice(0, 100);
  const existing = must(await db.from("category_review").select("seen").eq("raw_value", key).maybeSingle(), "category review") as { seen: number } | null;
  must(
    await db.from("category_review").upsert({ raw_value: key, seen: (existing?.seen ?? 0) + 1, example_job_id: jobId }),
    "category review",
  );
}
