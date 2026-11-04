import {
  EnrichedJobSchema,
  ResumeSchema,
  verifyCoverLetter,
  verifyResume,
  type CoverLetter,
  type EnrichedJob,
  type Resume,
  type VerifyIssue,
} from "@jobtailor/core";
import {
  assembleCoverLetter,
  assembleResume,
  COVER_LETTER_SYSTEM,
  CoverLetterDraftSchema,
  coverLetterUserPrompt,
  libraryContext,
  regenerationNote,
  ResumeDraftSchema,
  TAILOR_SYSTEM,
  tailorUserPrompt,
  type CoverLetterDraft,
  type ResumeDraft,
} from "@jobtailor/core/prompts";
import { addUsage, mayUseAi, ZERO_USAGE, type LlmProvider, type LlmRequest, type LlmResult, type LlmUsage } from "@jobtailor/llm";
import { MAX_LETTER_PAGES, MAX_RESUME_PAGES, renderCoverLetterPdf, renderResumePdf } from "@jobtailor/render";
import { must, type Db } from "../db";
import { log } from "../log";
import { BudgetExceeded, type Budget } from "./budget";
import type { ActiveUser } from "./users";

export const MAX_REGENERATIONS = 2;
const MAX_POSTING_CHARS = 20_000;

export interface TailorDeps {
  db: Db;
  provider: LlmProvider;
  budget: Budget;
  ownerEmail?: string;
  now?: Date;
}

export interface TailorJob {
  matchId: number;
  title: string;
  company: string;
  rawText: string;
  enriched: EnrichedJob;
}

export interface DraftOutcome<T> {
  ok: boolean;
  doc?: T;
  issues: VerifyIssue[];
  pdf?: Buffer;
  pages?: number;
  attempts: number;
  usage: LlmUsage;
  /** A provider stop (budget, rate limit, login). The match stays pending for the next run. */
  stoppedBy?: string;
  error?: string;
}

function resumeRequest(job: TailorJob, user: ActiveUser, note = ""): LlmRequest<ResumeDraft> {
  return {
    id: `resume-${job.matchId}`,
    tier: "strong",
    effort: "medium",
    system: TAILOR_SYSTEM,
    cachedContext: libraryContext(user.facts),
    user: tailorUserPrompt(job, user.preferences) + note,
    schema: ResumeDraftSchema,
  };
}

function letterRequest(job: TailorJob, user: ActiveUser, note = ""): LlmRequest<CoverLetterDraft> {
  return {
    id: `letter-${job.matchId}`,
    tier: "strong",
    effort: "medium",
    system: COVER_LETTER_SYSTEM,
    cachedContext: libraryContext(user.facts),
    user: coverLetterUserPrompt(job) + note,
    schema: CoverLetterDraftSchema,
  };
}

/**
 * The generate, verify, render loop. Any verifier error regenerates with the issues fed
 * back, at most twice. If it still fails, there's no document: never deliver it.
 */
export async function draftResume(
  deps: Pick<TailorDeps, "provider" | "budget">,
  job: TailorJob,
  user: ActiveUser,
  first?: LlmResult<ResumeDraft>,
): Promise<DraftOutcome<Resume>> {
  let usage = ZERO_USAGE;
  let note = "";
  let issues: VerifyIssue[] = [];
  let lastGood: { doc: Resume; pdf: Buffer; pages: number } | undefined;

  for (let attempt = 0; attempt <= MAX_REGENERATIONS; attempt++) {
    deps.budget.assertAvailable(user.id);
    const r = attempt === 0 && first ? first : await deps.provider.complete(resumeRequest(job, user, note));
    usage = addUsage(usage, r.usage);
    deps.budget.add(r.usage.costUsd, user.id);
    if (!r.ok) {
      if (r.kind === "rate_limit" || r.kind === "auth") return { ok: false, issues, attempts: attempt + 1, usage, stoppedBy: r.kind };
      return { ok: false, issues, attempts: attempt + 1, usage, error: r.kind };
    }
    const doc = assembleResume(r.data, user.facts, user.preferences);
    const v = verifyResume(doc, user.facts);
    issues = v.issues;
    if (!v.ok) {
      note = regenerationNote(v.issues);
      continue;
    }
    const { pdf, pages } = await renderResumePdf(doc, user.cvStyle);
    lastGood = { doc, pdf, pages };
    if (pages <= MAX_RESUME_PAGES) return { ok: true, doc, pdf, pages, issues, attempts: attempt + 1, usage };
    note = regenerationNote([], [`The CV renders to ${pages} pages; the limit is ${MAX_RESUME_PAGES}. Shorten bullets that wrap by a few words first, then drop the weakest bullets.`]);
  }
  // Clean on facts but long. That's safe to deliver, and the user can trim it in the editor.
  if (lastGood) return { ok: true, ...lastGood, issues, attempts: MAX_REGENERATIONS + 1, usage };
  return { ok: false, issues, attempts: MAX_REGENERATIONS + 1, usage, error: "failed_fact_check" };
}

export async function draftCoverLetter(
  deps: Pick<TailorDeps, "provider" | "budget" | "now">,
  job: TailorJob,
  user: ActiveUser,
  roleTitle: string,
): Promise<DraftOutcome<CoverLetter>> {
  let usage = ZERO_USAGE;
  let note = "";
  let issues: VerifyIssue[] = [];
  const date = (deps.now ?? new Date()).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  for (let attempt = 0; attempt <= MAX_REGENERATIONS; attempt++) {
    deps.budget.assertAvailable(user.id);
    const r = await deps.provider.complete(letterRequest(job, user, note));
    usage = addUsage(usage, r.usage);
    deps.budget.add(r.usage.costUsd, user.id);
    if (!r.ok) {
      if (r.kind === "rate_limit" || r.kind === "auth") return { ok: false, issues, attempts: attempt + 1, usage, stoppedBy: r.kind };
      return { ok: false, issues, attempts: attempt + 1, usage, error: r.kind };
    }
    const doc = assembleCoverLetter(r.data, roleTitle, user.facts, user.preferences, date);
    const v = verifyCoverLetter(doc, user.facts);
    issues = v.issues;
    if (!v.ok) {
      note = regenerationNote(v.issues);
      continue;
    }
    const { pdf, pages } = await renderCoverLetterPdf(doc, user.cvStyle);
    if (pages <= MAX_LETTER_PAGES) return { ok: true, doc, pdf, pages, issues, attempts: attempt + 1, usage };
    note = regenerationNote([], [`The letter renders to ${pages} pages and must be one. Cut words.`]);
  }
  return { ok: false, issues, attempts: MAX_REGENERATIONS + 1, usage, error: "failed_checks" };
}

async function upload(db: Db, path: string, pdf: Buffer): Promise<void> {
  const { error } = await db.storage.from("documents").upload(path, pdf, { contentType: "application/pdf", upsert: true });
  if (error) throw new Error(`upload: ${error.message}`);
}

async function storeVersion(db: Db, matchId: number, userId: string, kind: "resume" | "cover_letter", doc: unknown, issues: VerifyIssue[]): Promise<number> {
  const row = must(
    await db
      .from("resume_versions")
      .insert({ match_id: matchId, user_id: userId, kind, json: doc, source: "ai", verify_issues: issues })
      .select("id")
      .single(),
    "store version",
  ) as { id: number };
  return row.id;
}

async function storeDocument(
  db: Db,
  matchId: number,
  userId: string,
  kind: "resume_pdf" | "cover_letter_pdf",
  versionId: number,
  pdf: Buffer,
): Promise<void> {
  const path = `${userId}/${matchId}/${kind}-${versionId}.pdf`;
  await upload(db, path, pdf);
  must(await db.from("documents").insert({ match_id: matchId, user_id: userId, kind, storage_path: path, version_id: versionId }), "store document");
}

interface PendingRow {
  id: number;
  job_id: number;
  posting_text: string | null;
  jobs: { title: string; company: string; raw_text: string | null; enriched: unknown } | null;
}

export interface TailorResult {
  rendered: number;
  failed: number;
  stoppedBy?: string;
  usage: LlmUsage;
}

/**
 * Writes the CV someone asked for. Idempotent: an AI draft already stored isn't regenerated,
 * only rendered if its PDF is missing, so a crashed task resumes without paying twice.
 */
export async function tailorMatch(deps: TailorDeps, user: ActiveUser, matchId: number): Promise<TailorResult> {
  const result: TailorResult = { rendered: 0, failed: 0, usage: ZERO_USAGE };
  const access = mayUseAi(deps.provider.name, deps.ownerEmail, { email: user.email, isSynthetic: user.isSynthetic });
  if (!access.allowed) return result;

  const pending = must(
    await deps.db.from("matches").select("id,job_id,posting_text,jobs(title,company,raw_text,enriched)").eq("id", matchId).eq("user_id", user.id).in("tailor_status", ["pending", "drafted"]),
    "pending tailor",
  ) as unknown as PendingRow[];

  const jobs: TailorJob[] = [];
  for (const row of pending) {
    const parsed = EnrichedJobSchema.safeParse(row.jobs?.enriched);
    if (!row.jobs || !parsed.success) {
      must(await deps.db.from("matches").update({ tailor_status: "failed", tailor_error: "invalid_job_data" }).eq("id", row.id), "mark failed");
      result.failed++;
      continue;
    }
    jobs.push({
      matchId: row.id,
      title: row.jobs.title,
      company: row.jobs.company,
      rawText: (row.posting_text ?? row.jobs.raw_text ?? "").slice(0, MAX_POSTING_CHARS),
      enriched: parsed.data,
    });
  }

  // Resume a crash: a stored AI draft is rendered, not rewritten.
  const existing = jobs.length
    ? (must(
        await deps.db.from("resume_versions").select("id,match_id,json,kind").eq("user_id", user.id).eq("source", "ai").in("match_id", jobs.map((j) => j.matchId)),
        "existing drafts",
      ) as { id: number; match_id: number; json: unknown; kind: string }[])
    : [];
  const docs = jobs.length
    ? (must(await deps.db.from("documents").select("match_id,kind").eq("user_id", user.id).in("match_id", jobs.map((j) => j.matchId)), "existing docs") as { match_id: number; kind: string }[])
    : [];
  const draftFor = (m: number) => existing.find((e) => e.match_id === m && e.kind === "resume");
  const hasPdf = (m: number, kind: string) => docs.some((d) => d.match_id === m && d.kind === kind);

  // First drafts run together where the provider can batch at half price. Regeneration runs one by one.
  const needDraft = jobs.filter((j) => !draftFor(j.matchId));
  let firsts = new Map<string, LlmResult<ResumeDraft>>();
  try {
    deps.budget.assertAvailable(user.id);
    firsts = await deps.provider.completeMany(needDraft.map((j) => resumeRequest(j, user)));
  } catch (err) {
    if (err instanceof BudgetExceeded) result.stoppedBy = err.scope;
    else throw err;
  }

  for (const job of jobs) {
    if (result.stoppedBy) break;
    try {
      const stored = draftFor(job.matchId);
      let resume: Resume;
      if (stored) {
        resume = ResumeSchema.parse(stored.json);
        if (!hasPdf(job.matchId, "resume_pdf")) {
          const { pdf } = await renderResumePdf(resume, user.cvStyle);
          await storeDocument(deps.db, job.matchId, user.id, "resume_pdf", stored.id, pdf);
        }
      } else {
        const out = await draftResume(deps, job, user, firsts.get(`resume-${job.matchId}`));
        result.usage = addUsage(result.usage, out.usage);
        if (out.stoppedBy) {
          result.stoppedBy = out.stoppedBy;
          break;
        }
        if (!out.ok || !out.doc || !out.pdf) {
          result.failed++;
          log("tailor.failed", { matchId: job.matchId, userId: user.id, attempts: out.attempts, reason: out.error, issues: out.issues.length });
          must(
            await deps.db.from("matches").update({ tailor_status: "failed", tailor_error: out.error ?? "failed" }).eq("id", job.matchId),
            "mark failed",
          );
          continue;
        }
        const versionId = await storeVersion(deps.db, job.matchId, user.id, "resume", out.doc, out.issues);
        must(await deps.db.from("matches").update({ tailor_status: "drafted" }).eq("id", job.matchId), "mark drafted");
        await storeDocument(deps.db, job.matchId, user.id, "resume_pdf", versionId, out.pdf);
        resume = out.doc;
      }

      if (job.enriched.asksForCoverLetter && !hasPdf(job.matchId, "cover_letter_pdf")) {
        const out = await draftCoverLetter(deps, job, user, resume.header.roleTitle);
        result.usage = addUsage(result.usage, out.usage);
        if (out.stoppedBy) {
          result.stoppedBy = out.stoppedBy;
          break;
        }
        if (out.ok && out.doc && out.pdf) {
          const versionId = await storeVersion(deps.db, job.matchId, user.id, "cover_letter", out.doc, out.issues);
          await storeDocument(deps.db, job.matchId, user.id, "cover_letter_pdf", versionId, out.pdf);
        } else {
          // The CV still goes out. The summary says the letter couldn't be written.
          log("tailor.letter_failed", { matchId: job.matchId, userId: user.id, reason: out.error });
          must(await deps.db.from("matches").update({ tailor_error: "cover_letter_failed" }).eq("id", job.matchId), "note letter");
        }
      }
      must(await deps.db.from("matches").update({ tailor_status: "rendered" }).eq("id", job.matchId), "mark rendered");
      result.rendered++;
    } catch (err) {
      if (err instanceof BudgetExceeded) {
        result.stoppedBy = err.scope;
        break;
      }
      result.failed++;
      log("tailor.error", { matchId: job.matchId, userId: user.id, kind: err instanceof Error ? err.name : "unknown" });
      must(await deps.db.from("matches").update({ tailor_status: "failed", tailor_error: "render_or_store_failed" }).eq("id", job.matchId), "mark failed");
    }
  }

  await deps.budget.record("tailor", result.usage, result.stoppedBy ? "failed" : "ok", user.id, result.stoppedBy ?? null);
  log("tailor.done", { userId: user.id, rendered: result.rendered, failed: result.failed, stoppedBy: result.stoppedBy, calls: result.usage.calls });
  return result;
}
