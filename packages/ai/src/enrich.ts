import { EnrichedJobSchema, type Category, type EnrichedJob } from "@cvtailor/core";
import { enrichSystemPrompt, enrichUserPrompt } from "@cvtailor/core/prompts";
import type { LlmRequest } from "@cvtailor/llm";

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

/** What a check of the live posting found. The worker makes these checks; a pasted job has none. */
export interface LiveFacts {
  reachable: boolean;
  closedSignal: string | null;
  jsonLd: Record<string, unknown> | null;
  postedAt: string | null;
  text: string | null;
  record?: { atsFields: Record<string, unknown>; locationText: string } | null;
}

const MAX_TEXT_FOR_MODEL = 20_000;

export function buildEnrichRequest(job: JobRow, live: LiveFacts | null, categories: Category[]): LlmRequest<EnrichedJob> {
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
export function reconcile(e: EnrichedJob, job: JobRow, live: LiveFacts | null, categories: Set<string>): EnrichedJob {
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
