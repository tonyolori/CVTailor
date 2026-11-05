import { DEFAULT_CV_REQUESTS_PER_DAY, PASTED_JOB_TITLE, type Category } from "@cvtailor/core";
import {
  EXTRACT_FACTS_SYSTEM,
  extractFactsUserPrompt,
  ProposedLibrarySchema,
  suggestTitlesSystem,
  suggestTitlesUserPrompt,
  TitleSuggestionsSchema,
} from "@cvtailor/core/prompts";
import { mayUseAi, type LlmProvider } from "@cvtailor/llm";
import { errorInfo, must, type Db } from "../db";
import { log } from "../log";
import { BudgetExceeded, type Budget } from "./budget";
import { buildEnrichRequest, reconcile, type JobRow } from "./enrich";
import { tailorMatch } from "./tailor";
import { loadUser } from "./users";

interface Task {
  id: number;
  user_id: string;
  kind: "extract_facts" | "suggest_titles" | "tailor_match";
  input: Record<string, unknown>;
  match_id: number | null;
  cv_bucket: string | null;
  created_at: string;
}

export interface TaskOptions {
  billingEnforced?: boolean;
  cvRequestsPerDay?: number;
  now?: Date;
}

const MAX_CV_CHARS = 60_000;

/** Work the web app queued because it has no AI of its own. CV text is erased once processed. */
export async function processAiTasks(db: Db, provider: LlmProvider, budget: Budget, ownerEmail: string | undefined, options: TaskOptions = {}, limit = 10): Promise<number> {
  let done = 0;
  for (let i = 0; i < limit; i++) {
    const claimed = await db.rpc("claim_ai_task").maybeSingle();
    if (claimed.error) throw new Error(`claim task: ${claimed.error.message}`);
    const task = claimed.data as Task | null;
    if (!task?.id) break;
    await runTask(db, provider, budget, ownerEmail, task, options);
    done++;
  }
  return done;
}

async function runTask(db: Db, provider: LlmProvider, budget: Budget, ownerEmail: string | undefined, task: Task, options: TaskOptions): Promise<void> {
  // A CV that wasn't written doesn't use up the person's allowance.
  const finish = async (fields: Record<string, unknown>) => {
    must(await db.from("ai_tasks").update({ input: {}, ...fields }).eq("id", task.id), "finish task");
    if (task.kind === "tailor_match" && fields.status !== "done") {
      const { error } = await db.rpc("refund_task_cv", { task_id: task.id });
      if (error) log("ai_task.refund_failed", { taskId: task.id, userId: task.user_id });
    }
  };

  const profile = must(await db.from("profiles").select("email,is_synthetic").eq("id", task.user_id).single(), "task profile") as { email: string; is_synthetic: boolean };
  const access = mayUseAi(provider.name, ownerEmail, { email: profile.email, isSynthetic: profile.is_synthetic });
  if (!access.allowed) {
    if (task.match_id) await markMatch(db, task.match_id, "ai_unavailable");
    await finish({ status: "skipped", error: access.reason });
    return;
  }

  try {
    budget.assertAvailable(task.user_id);
    if (task.kind === "tailor_match") {
      await finish(await writeRequestedCv(db, provider, budget, ownerEmail, task, options));
    } else if (task.kind === "extract_facts") {
      const r = await provider.complete({
        id: `task-${task.id}`,
        tier: "strong",
        effort: "low",
        system: EXTRACT_FACTS_SYSTEM,
        user: extractFactsUserPrompt(String(task.input.cvText ?? "").slice(0, MAX_CV_CHARS), profile.email),
        schema: ProposedLibrarySchema,
      });
      budget.add(r.usage.costUsd, task.user_id);
      await budget.record("onboarding", r.usage, r.ok ? "ok" : "failed", task.user_id, r.ok ? null : r.kind);
      await finish(r.ok ? { status: "done", output: r.data } : { status: "failed", error: r.error });
    } else {
      const categories = must(await db.from("categories").select("id,label"), "categories") as { id: string; label: string }[];
      const facts = must(await db.from("fact_library").select("data").eq("user_id", task.user_id).maybeSingle(), "task facts") as { data: never } | null;
      const r = await provider.complete({
        id: `task-${task.id}`,
        tier: "small",
        effort: "low",
        system: suggestTitlesSystem(categories),
        user: suggestTitlesUserPrompt((task.input.targetTitles as string[]) ?? [], facts?.data ?? null),
        schema: TitleSuggestionsSchema,
      });
      budget.add(r.usage.costUsd, task.user_id);
      await budget.record("onboarding", r.usage, r.ok ? "ok" : "failed", task.user_id, r.ok ? null : r.kind);
      await finish(r.ok ? { status: "done", output: r.data } : { status: "failed", error: r.error });
    }
    log("ai_task.done", { taskId: task.id, userId: task.user_id, kind: task.kind });
  } catch (err) {
    log("ai_task.failed", { taskId: task.id, ...errorInfo(err) }, "error");
    if (task.kind === "tailor_match") {
      if (task.match_id) await markMatch(db, task.match_id, err instanceof BudgetExceeded ? "budget" : "failed");
      await finish({ status: "failed", error: err instanceof BudgetExceeded ? BUDGET_MESSAGE : RETRY_MESSAGE });
    } else {
      await finish({ status: "failed", error: "Couldn't run this now. You can fill it in by hand." });
    }
  }
}

export const NOT_ENTITLED_MESSAGE = "You've used all your CVs.";
export const LIMIT_MESSAGE = "You've reached today's limit for writing CVs. Try again tomorrow.";
const BUDGET_MESSAGE = "We can't write more CVs today. Try again tomorrow.";
const RETRY_MESSAGE = "We couldn't write this CV just now. Try again in a little while.";
const FACT_CHECK_MESSAGE = "The CV kept including things that aren't in your library, so we didn't keep it. Try again, or add more of your experience to your library first.";

async function markMatch(db: Db, matchId: number, reason: string): Promise<void> {
  must(await db.from("matches").update({ tailor_status: "failed", tailor_error: reason }).eq("id", matchId), "mark match");
}

/**
 * People asking for a CV are checked here as well as on the web, because this is what spends the
 * money. With billing on, only a task holding a CV from someone's allowance runs.
 */
async function writeRequestedCv(db: Db, provider: LlmProvider, budget: Budget, ownerEmail: string | undefined, task: Task, options: TaskOptions): Promise<Record<string, unknown>> {
  const matchId = task.match_id;
  if (!matchId) return { status: "failed", error: RETRY_MESSAGE };
  const refuse = async (reason: string, error: string) => {
    await markMatch(db, matchId, reason);
    return { status: "skipped", error };
  };
  const now = options.now ?? new Date();

  const user = await loadUser(db, task.user_id);
  if (!user) return refuse("no_library", "Finish adding your experience and preferences first.");
  if (options.billingEnforced && (!task.cv_bucket || task.cv_bucket === "none")) return refuse("not_entitled", NOT_ENTITLED_MESSAGE);

  const dayStart = `${now.toISOString().slice(0, 10)}T00:00:00Z`;
  const { count, error } = await db
    .from("ai_tasks")
    .select("id", { count: "exact", head: true })
    .eq("user_id", task.user_id)
    .eq("kind", "tailor_match")
    .neq("status", "skipped")
    .lt("id", task.id)
    .gte("created_at", dayStart);
  if (error) throw new Error("count requests");
  if ((count ?? 0) >= (options.cvRequestsPerDay ?? DEFAULT_CV_REQUESTS_PER_DAY)) return refuse("daily_limit", LIMIT_MESSAGE);

  const enriched = await enrichIfNeeded(db, provider, budget, task.user_id, matchId);
  if (!enriched) {
    await markMatch(db, matchId, "enrich_failed");
    return { status: "failed", error: RETRY_MESSAGE };
  }

  const result = await tailorMatch({ db, provider, budget, ownerEmail, now }, user, matchId);
  if (result.rendered > 0) return { status: "done", output: { matchId } };
  if (result.stoppedBy) {
    await markMatch(db, matchId, "budget");
    return { status: "failed", error: BUDGET_MESSAGE };
  }
  const row = must(await db.from("matches").select("tailor_error").eq("id", matchId).single(), "tailor outcome") as { tailor_error: string | null };
  return { status: "failed", error: row.tailor_error === "failed_fact_check" ? FACT_CHECK_MESSAGE : RETRY_MESSAGE };
}

/**
 * A pasted posting hasn't been read yet. It goes through the same cheap, tool-less read as any
 * other posting, so its instructions to applicants are surfaced and never obeyed.
 */
async function enrichIfNeeded(db: Db, provider: LlmProvider, budget: Budget, userId: string, matchId: number): Promise<boolean> {
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
