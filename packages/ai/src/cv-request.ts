import { randomUUID } from "node:crypto";
import { MAX_POSTING_CHARS, MIN_POSTING_CHARS, PASTED_JOB_TITLE, type Category } from "@cvtailor/core";
import type { LlmProvider } from "@cvtailor/llm";
import { errorFields } from "@cvtailor/core/log";
import { BudgetExceeded, type Budget } from "./budget";
import { must, type Db } from "./db";
import { buildEnrichRequest, reconcile, type JobRow } from "./enrich";
import { log } from "./log";
import { tailorMatch } from "./tailor";
import { loadUser } from "./users";

export const NOT_ENTITLED_MESSAGE = "You've used all your CVs.";
export const BUDGET_MESSAGE = "We can't write more CVs today. Try again tomorrow.";
export const RETRY_MESSAGE = "We couldn't write this CV just now. Try again in a little while.";
export const TIMED_OUT_MESSAGE = "Writing this CV took too long, so we stopped. Try again, and it won't use up a CV.";
export const FACT_CHECK_MESSAGE = "The CV kept including things that aren't in your library, so we didn't keep it. Try again, or add more of your experience to your library first.";
const TOO_SHORT = "That looks too short to be a full job posting. Paste the whole posting, including what the role involves.";
const START_FAILED = "Couldn't start that. Try again shortly.";

/** A job we hold already, or one pasted in. */
export interface CvAsk {
  matchId?: number;
  text?: string;
  title?: string;
  company?: string;
  /** Already checked to be a safe link. */
  applyUrl?: string | null;
}

export interface OpenOptions {
  billingEnforced: boolean;
  cvRequestsPerDay: number;
  now?: Date;
}

export type Opened = { ok: true; requestId: number; matchId: number } | { ok: false; status: number; error: string; upgrade?: true };

/**
 * Asks for a CV. Takes one from the person's allowance when billing is on, and records the
 * request, which gives the CV back if it isn't written. Writing it is `writeRequestedCv`.
 */
export async function openCvRequest(db: Db, userId: string, ask: CvAsk, options: OpenOptions): Promise<Opened> {
  const refuse = (status: number, error: string): Opened => ({ ok: false, status, error });

  const facts = must(await db.from("fact_library").select("user_id").eq("user_id", userId).maybeSingle(), "facts exist");
  if (!facts) return refuse(409, "Add your experience to your library first, so there's something to write from.");

  const text = ask.text?.trim() ?? "";
  if (text && text.length < MIN_POSTING_CHARS) return refuse(400, TOO_SHORT);
  if (!ask.matchId && !text) return refuse(400, TOO_SHORT);

  // A request cut off with its function frees the job and its CV before anything is counted.
  await expireCvRequests(db, userId);

  if (ask.matchId) {
    const match = must(
      await db.from("matches").select("id,tailor_status,posting_text,jobs(raw_text)").eq("id", ask.matchId).eq("user_id", userId).maybeSingle(),
      "asked match",
    ) as { id: number; tailor_status: string; posting_text: string | null; jobs: { raw_text: string | null } | null } | null;
    if (!match) return refuse(404, "We couldn't find that job.");
    if (match.tailor_status === "rendered") return refuse(409, "This job already has a CV.");
    if (!text && !match.posting_text && !match.jobs?.raw_text?.trim()) return refuse(400, "We don't have this posting's text. Paste it to write a CV.");

    // Asking twice shouldn't cost twice.
    const running = await runningFor(db, match.id);
    if (running) return { ok: true, requestId: running, matchId: match.id };
  }

  const now = options.now ?? new Date();
  const { count, error: countError } = await db
    .from("cv_requests")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", `${now.toISOString().slice(0, 10)}T00:00:00Z`);
  if (countError) return refuse(500, START_FAILED);
  if ((count ?? 0) >= options.cvRequestsPerDay) return refuse(429, `You can write up to ${options.cvRequestsPerDay} CVs a day. Try again tomorrow.`);

  // Last of the checks and first of the changes: everything after this must give the CV back on failure.
  let bucket = "none";
  if (options.billingEnforced) {
    const { data: reserved, error } = await db.rpc("reserve_cv", { uid: userId });
    if (error) return refuse(500, START_FAILED);
    if (!reserved) return { ok: false, status: 402, error: NOT_ENTITLED_MESSAGE, upgrade: true };
    bucket = reserved as string;
  }
  const fail = async (error: string): Promise<Opened> => {
    if (bucket !== "none") await db.rpc("return_cv", { uid: userId, bucket });
    return refuse(500, error);
  };

  let matchId: number;
  if (ask.matchId) {
    // Held on this person's match, never on a job other people share.
    const { error } = await db
      .from("matches")
      .update({ tailor_status: "pending", tailor_error: null, ...(text ? { posting_text: text.slice(0, MAX_POSTING_CHARS) } : {}) })
      .eq("id", ask.matchId)
      .eq("user_id", userId);
    if (error) return fail(START_FAILED);
    matchId = ask.matchId;
  } else {
    // A private job: only its owner can read it, and the daily pipeline never touches it.
    // The address is a placeholder. Nothing ever fetches a pasted job.
    const { data: job, error: jobError } = await db
      .from("jobs")
      .insert({
        owner_id: userId,
        url: `pasted:${randomUUID()}`,
        apply_url: ask.applyUrl ?? null,
        title: ask.title?.trim().slice(0, 120) || PASTED_JOB_TITLE,
        company: ask.company?.trim().slice(0, 120) || "Company not stated",
        source: "pasted",
        raw_text: text.slice(0, MAX_POSTING_CHARS),
        status: "new",
      })
      .select("id")
      .single();
    if (jobError || !job) return fail("Couldn't save that posting. Try again shortly.");
    const { data: match, error: matchError } = await db
      .from("matches")
      .insert({ user_id: userId, job_id: job.id, decision: "pasted", reason: "You pasted this job in yourself.", tailor_status: "pending" })
      .select("id")
      .single();
    if (matchError || !match) {
      await db.from("jobs").delete().eq("id", job.id);
      return fail("Couldn't save that posting. Try again shortly.");
    }
    matchId = match.id;
  }

  const { data: request, error } = await db.from("cv_requests").insert({ user_id: userId, match_id: matchId, cv_bucket: bucket }).select("id").single();
  if (error?.code === "23505") {
    // Another click got there first. Theirs is the one that runs.
    const running = await runningFor(db, matchId);
    if (bucket !== "none") await db.rpc("return_cv", { uid: userId, bucket });
    if (running) return { ok: true, requestId: running, matchId };
  }
  if (error || !request) return fail(START_FAILED);
  return { ok: true, requestId: request.id as number, matchId };
}

async function runningFor(db: Db, matchId: number): Promise<number | null> {
  const row = must(await db.from("cv_requests").select("id").eq("match_id", matchId).eq("status", "running").maybeSingle(), "running request") as { id: number } | null;
  return row?.id ?? null;
}

/** Ends requests left running by a function that was cut off. Null means everyone's. */
export async function expireCvRequests(db: Db, userId: string | null): Promise<number> {
  const { data, error } = await db.rpc("expire_cv_requests", { uid: userId });
  if (error) {
    log("cv_request.expire_failed", { userId: userId ?? undefined }, "error");
    return 0;
  }
  return (data as number) ?? 0;
}

export interface WriteDeps {
  db: Db;
  provider: LlmProvider;
  budget: Budget;
  now?: Date;
  /** Stops before the host cuts the function off, so the request still ends and its CV goes back. */
  deadlineMs?: number;
}

export type Written = { status: "done" } | { status: "failed"; error: string };

/** Writes the CV for an open request and ends it. Never throws: every outcome is recorded. */
export async function writeRequestedCv(deps: WriteDeps, request: { id: number; userId: string; matchId: number }): Promise<Written> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<"timed_out">((resolve) => {
    timer = setTimeout(() => resolve("timed_out"), deps.deadlineMs ?? 270_000);
  });
  let outcome: Written;
  try {
    const result = await Promise.race([write(deps, request), deadline]);
    if (result === "timed_out") {
      log("cv_request.timed_out", { requestId: request.id, userId: request.userId }, "error");
      await markMatch(deps.db, request.matchId, "timed_out").catch(() => undefined);
      outcome = { status: "failed", error: TIMED_OUT_MESSAGE };
    } else {
      outcome = result;
    }
  } catch (err) {
    log("cv_request.failed", { requestId: request.id, userId: request.userId, ...errorFields(err) }, "error");
    const budget = err instanceof BudgetExceeded;
    await markMatch(deps.db, request.matchId, budget ? "budget" : "failed").catch(() => undefined);
    outcome = { status: "failed", error: budget ? BUDGET_MESSAGE : RETRY_MESSAGE };
  } finally {
    clearTimeout(timer);
  }

  const { error } = await deps.db.rpc("finish_cv_request", { request_id: request.id, ok: outcome.status === "done", err: outcome.status === "failed" ? outcome.error : null });
  if (error) log("cv_request.finish_failed", { requestId: request.id, userId: request.userId }, "error");
  log("cv_request.done", { requestId: request.id, userId: request.userId, status: outcome.status });
  return outcome;
}

async function write(deps: WriteDeps, request: { id: number; userId: string; matchId: number }): Promise<Written> {
  const { db } = deps;
  const { matchId } = request;
  const user = await loadUser(db, request.userId);
  if (!user) {
    await markMatch(db, matchId, "no_library");
    return { status: "failed", error: "Finish adding your experience and preferences first." };
  }

  const enriched = await enrichIfNeeded(deps, request.userId, matchId);
  if (!enriched) {
    await markMatch(db, matchId, "enrich_failed");
    return { status: "failed", error: RETRY_MESSAGE };
  }

  const result = await tailorMatch({ db, provider: deps.provider, budget: deps.budget, now: deps.now }, user, matchId);
  if (result.rendered > 0) return { status: "done" };
  if (result.stoppedBy) {
    // A budget stop, or the provider refusing for now: a rate limit, a bad key or an empty balance.
    const budget = ["global", "user", "kill_switch"].includes(result.stoppedBy);
    await markMatch(db, matchId, budget ? "budget" : "provider_unavailable");
    return { status: "failed", error: budget ? BUDGET_MESSAGE : RETRY_MESSAGE };
  }
  const row = must(await db.from("matches").select("tailor_error").eq("id", matchId).single(), "tailor outcome") as { tailor_error: string | null };
  return { status: "failed", error: row.tailor_error === "failed_fact_check" ? FACT_CHECK_MESSAGE : RETRY_MESSAGE };
}

async function markMatch(db: Db, matchId: number, reason: string): Promise<void> {
  must(await db.from("matches").update({ tailor_status: "failed", tailor_error: reason }).eq("id", matchId).neq("tailor_status", "rendered"), "mark match");
}

/**
 * A pasted posting hasn't been read yet. It goes through the same cheap, tool-less read as any
 * other posting, so its instructions to applicants are surfaced and never obeyed.
 */
async function enrichIfNeeded(deps: WriteDeps, userId: string, matchId: number): Promise<boolean> {
  const { db, provider, budget } = deps;
  const row = must(await db.from("matches").select("posting_text,jobs(*)").eq("id", matchId).single(), "requested match") as unknown as {
    posting_text: string | null;
    jobs: (JobRow & { enriched: unknown; owner_id: string | null }) | null;
  };
  const job = row.jobs;
  if (!job) return false;
  if (job.enriched) return true;

  const categories = must(await db.from("categories").select("id,keywords"), "categories") as Category[];
  budget.assertAvailable(userId);
  const r = await provider.complete(buildEnrichRequest({ ...job, raw_text: row.posting_text ?? job.raw_text }, null, categories));
  budget.add(r.usage.costUsd, userId);
  await budget.record("enrich", r.usage, r.ok ? "ok" : "failed", userId, r.ok ? null : r.kind);
  if (!r.ok) return false;

  // Only someone's own pasted job is written to here. A shared job is enriched by the daily run.
  if (job.owner_id !== userId) return true;
  const e = reconcile(r.data, job, null, new Set(categories.map((c) => c.id)));
  must(
    await db
      .from("jobs")
      .update({ enriched: e, status: "enriched", category: e.category, work_mode: e.workMode, ...(job.title === PASTED_JOB_TITLE && e.occupationTitle ? { title: e.occupationTitle.slice(0, 120) } : {}) })
      .eq("id", job.id),
    "store pasted enrichment",
  );
  return true;
}
