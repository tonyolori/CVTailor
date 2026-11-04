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
 * `--tasks-only` skips the daily run and handles only tasks people are waiting on: onboarding's AI steps and CVs on request.
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

const TICK_MS = 60_000;
const TASK_MS = 5_000;
let lastTick = 0;

async function pass(): Promise<void> {
  // People are waiting on tasks, so those are checked far more often than the daily run needs.
  const due = !tasksOnly && Date.now() - lastTick >= TICK_MS;
  const decision = due ? await tick(deps) : undefined;
  if (due) lastTick = Date.now();
  const budget = new Budget(db, provider.name, { globalUsd: config.GLOBAL_DAILY_BUDGET_USD, userUsd: config.USER_DAILY_BUDGET_USD });
  await budget.load();
  const tasks = await processAiTasks(db, provider, budget, config.OWNER_EMAIL, { billingEnforced: config.BILLING_ENFORCED, cvRequestsPerDay: config.CV_REQUESTS_PER_DAY });
  if (due || tasks) log("worker.pass", { decision, tasks });
}

if (process.argv.includes("--loop")) {
  log("worker.loop_start", { provider: provider.name });
  for (;;) {
    await pass().catch((err: unknown) => log("worker.pass_failed", { kind: err instanceof Error ? err.name : "unknown" }));
    await new Promise((resolve) => setTimeout(resolve, TASK_MS));
  }
} else {
  await pass();
}
