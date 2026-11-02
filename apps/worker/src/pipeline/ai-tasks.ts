import {
  EXTRACT_FACTS_SYSTEM,
  extractFactsUserPrompt,
  ProposedLibrarySchema,
  suggestTitlesSystem,
  suggestTitlesUserPrompt,
  TitleSuggestionsSchema,
} from "@jobtailor/core/prompts";
import { mayUseAi, type LlmProvider } from "@jobtailor/llm";
import { must, type Db } from "../db";
import { log } from "../log";
import type { Budget } from "./budget";

interface Task {
  id: number;
  user_id: string;
  kind: "extract_facts" | "suggest_titles";
  input: Record<string, unknown>;
}

const MAX_CV_CHARS = 60_000;

/** Onboarding work the web app queued because it has no AI of its own. The CV text is erased once processed. */
export async function processAiTasks(db: Db, provider: LlmProvider, budget: Budget, ownerEmail: string | undefined, limit = 10): Promise<number> {
  let done = 0;
  for (let i = 0; i < limit; i++) {
    const claimed = await db.rpc("claim_ai_task").maybeSingle();
    if (claimed.error) throw new Error(`claim task: ${claimed.error.message}`);
    const task = claimed.data as Task | null;
    if (!task?.id) break;
    await runTask(db, provider, budget, ownerEmail, task);
    done++;
  }
  return done;
}

async function runTask(db: Db, provider: LlmProvider, budget: Budget, ownerEmail: string | undefined, task: Task): Promise<void> {
  const finish = async (fields: Record<string, unknown>) =>
    must(await db.from("ai_tasks").update({ input: {}, ...fields }).eq("id", task.id), "finish task");

  const profile = must(await db.from("profiles").select("email,is_synthetic").eq("id", task.user_id).single(), "task profile") as { email: string; is_synthetic: boolean };
  const access = mayUseAi(provider.name, ownerEmail, { email: profile.email, isSynthetic: profile.is_synthetic });
  if (!access.allowed) {
    await finish({ status: "skipped", error: access.reason });
    return;
  }

  try {
    budget.assertAvailable(task.user_id);
    if (task.kind === "extract_facts") {
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
    log("ai_task.failed", { taskId: task.id, kind: err instanceof Error ? err.name : "unknown" });
    await finish({ status: "failed", error: "Couldn't run this now. You can fill it in by hand." });
  }
}
