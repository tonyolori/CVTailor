import { join } from "node:path";
import { createProvider } from "@jobtailor/llm";
import { llmConfig, loadConfig } from "./config";
import { serviceClient } from "./db";
import { fileSender, resendSender } from "./email/send";
import { log } from "./log";
import { processAiTasks } from "./pipeline/ai-tasks";
import { Budget } from "./pipeline/budget";
import { tick, type RunDeps } from "./pipeline/run";
import { ATS_HOST_POLICIES } from "./sources/ats";
import { AGGREGATORS } from "./sources/aggregators";
import { politeHttp } from "./sources/http";

/**
 * `npm run worker` makes one pass and exits, which suits a scheduler.
 * `npm run worker -- --loop` stays up, so emails go at each user's send_time and
 * onboarding tasks get picked up. Either way, a missed run is caught up on start.
 * `--tasks-only` skips the daily run and handles only onboarding tasks, which otherwise wait for it.
 */
const config = loadConfig();
const db = serviceClient(config);
const provider = await createProvider(llmConfig(config));
const policies = {
  ...ATS_HOST_POLICIES,
  ...Object.fromEntries(AGGREGATORS.map((a) => [a.rateLimit.host, { minIntervalMs: a.rateLimit.minIntervalMs }])),
};
const deps: RunDeps = {
  db,
  http: politeHttp(policies),
  provider,
  config,
  sender:
    config.EMAIL_PROVIDER === "resend" && config.EMAIL_API_KEY
      ? resendSender(config.EMAIL_API_KEY)
      : fileSender(join(import.meta.dirname, "../../../.local/outbox")),
};

const tasksOnly = process.argv.includes("--tasks-only");

async function pass(): Promise<void> {
  const decision = tasksOnly ? "tasks_only" : await tick(deps);
  const budget = new Budget(db, provider.name, { globalUsd: config.GLOBAL_DAILY_BUDGET_USD, userUsd: config.USER_DAILY_BUDGET_USD });
  await budget.load();
  const tasks = await processAiTasks(db, provider, budget, config.OWNER_EMAIL);
  log("worker.pass", { decision, tasks });
}

const TICK_MS = tasksOnly ? 5_000 : 60_000;

if (process.argv.includes("--loop")) {
  log("worker.loop_start", { provider: provider.name });
  for (;;) {
    await pass().catch((err: unknown) => log("worker.pass_failed", { kind: err instanceof Error ? err.name : "unknown" }));
    await new Promise((resolve) => setTimeout(resolve, TICK_MS));
  }
} else {
  await pass();
}
