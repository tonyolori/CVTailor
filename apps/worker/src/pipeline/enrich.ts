import { EnrichedJobSchema, type Category, type EnrichedJob } from "@cvtailor/core";
import { enrichSystemPrompt, enrichUserPrompt } from "@cvtailor/core/prompts";
import { addUsage, ZERO_USAGE, type LlmProvider, type LlmRequest, type LlmUsage } from "@cvtailor/llm";
import { must, type Db } from "../db";
import { log } from "../log";
import type { Http } from "../sources/http";
import { BudgetExceeded, type Budget } from "./budget";
import { checkLive, type LiveCheck } from "./live";

export interface JobRow {
  id: number;
  url: string;
  apply_url: string | null;
  company: string;
  title: string;
  source: string;
  posted_at: string | null;
  ats_posted_at: string | null;
  from_ats: boolean;
  raw_text: string | null;
  location_text: string | null;
  work_mode?: string | null;
  ats_fields: Record<string, unknown> | null;
  last_verified: string | null;
}

const MAX_TEXT_FOR_MODEL = 20_000;

export function buildEnrichRequest(job: JobRow, live: LiveCheck | null, categories: Category[]): LlmRequest<EnrichedJob> {
  const text = job.raw_text?.trim() ? job.raw_text : (live?.text ?? "");
  // The employer's own fields, when the live check found them, sit beside the source's.
  const structuredFields = live?.record
    ? { ...job.ats_fields, employerRecord: live.record.atsFields, employerLocation: live.record.locationText }
    : (job.ats_fields ?? {});
  return {
    id: String(job.id),
    tier: "small",
    effort: "low",
    maxTokens: 4000,
    system: enrichSystemPrompt(categories),
    user: enrichUserPrompt({
      title: job.title,
      company: job.company,
      source: job.source,
      locationText: job.location_text ?? "",
      postedAtFromSource: job.posted_at,
      structuredFields,
      livePage: live?.reachable ? { jsonLd: live.jsonLd, closedSignal: live.closedSignal } : null,
      text: text.slice(0, MAX_TEXT_FOR_MODEL),
    }),
    schema: EnrichedJobSchema,
  };
}

/**
 * Facts code can establish beat the model's reading. The employer's date beats the
 * aggregator's, and an explicit closed signal closes the posting.
 */
export function reconcile(e: EnrichedJob, job: JobRow, live: LiveCheck | null, categories: Set<string>): EnrichedJob {
  const postedAt = job.ats_posted_at ?? live?.postedAt ?? e.postedAt ?? job.posted_at;
  return {
    ...e,
    postedAt,
    isOpen: e.isOpen && !live?.closedSignal && !expired(job),
    category: categories.has(e.category) ? e.category : "other",
    // A remote-only board or an ATS field settles it when the posting's words don't.
    workMode: e.workMode === "unclear" && isWorkMode(job.work_mode) ? job.work_mode : e.workMode,
  };
}

/** A source's own expiry date. Himalayas' terms also require expired jobs to be removed. */
function expired(job: JobRow): boolean {
  const at = job.ats_fields?.expiresAt;
  return typeof at === "string" && new Date(at).getTime() < Date.now();
}

function isWorkMode(v: string | null | undefined): v is "remote" | "hybrid" | "onsite" {
  return v === "remote" || v === "hybrid" || v === "onsite";
}

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

/** Each posting is enriched once and shared by all users. Failures don't stop the rest. */
export async function enrichPending(
  db: Db,
  http: Http,
  provider: LlmProvider,
  budget: Budget,
  categories: Category[],
  maxPerRun = 300,
): Promise<EnrichResult> {
  const jobs = must(
    // Employers' own boards first, because their dates and locations can be trusted, then newest.
    // Otherwise whichever source was fetched first uses up the whole cap.
    await db
      .from("jobs")
      .select("*")
      .eq("status", "new")
      .is("owner_id", null)
      .order("from_ats", { ascending: false })
      .order("posted_at", { ascending: false, nullsFirst: false })
      .limit(maxPerRun),
    "pending jobs",
  ) as JobRow[];
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
