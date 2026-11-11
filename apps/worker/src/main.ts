import { execFileSync } from "node:child_process";
import { hostname } from "node:os";
import { join } from "node:path";
import { alertsSent, setAlertSink, slackAlerts } from "@cvtailor/core/alert";
import { createProvider, withLogging } from "@cvtailor/llm";
import { llmConfig, loadConfig } from "./config";
import { errorInfo, serviceClient } from "./db";
import { fileSender, mailpitSender, resendSender } from "./email/send";
import { log } from "./log";
import { tick, type RunDeps } from "./pipeline/run";
import { ATS_HOST_POLICIES } from "./sources/ats";
import { AGGREGATORS } from "./sources/aggregators";
import { politeHttp } from "./sources/http";

/**
 * The worker finds jobs, scores them for each person and sends their emails. CVs and onboarding's
 * AI steps run on the web host as people ask, so nothing here waits on anyone.
 * `npm run worker` makes one pass and exits, which suits a scheduler.
 * `npm run worker -- --loop` stays up, so emails go at each user's send_time. Either way, a
 * missed run is caught up on start.
 */
const config = loadConfig();
if (config.SLACK_ALERT_WEBHOOK_URL) {
  setAlertSink(slackAlerts({ webhookUrl: config.SLACK_ALERT_WEBHOOK_URL, source: "worker", context: [`host ${hostname()}`, `commit ${commit()}`, `node ${process.version}`] }));
}

/** Which code is running, for the alerts. The worker runs from a checkout. */
function commit(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: import.meta.dirname, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

/** Anything nothing else caught still reaches Slack before the worker stops. */
async function crash(event: string, err: unknown): Promise<never> {
  log(event, errorInfo(err), "error");
  await alertsSent();
  process.exit(1);
}
process.on("uncaughtException", (err) => void crash("worker.crashed", err));
process.on("unhandledRejection", (err) => void crash("worker.unhandled_rejection", err));
const db = serviceClient(config);
const provider = withLogging(await createProvider(llmConfig(config)), log);
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
      : config.EMAIL_PROVIDER === "mailpit"
        ? mailpitSender(config.MAILPIT_URL)
        : fileSender(join(import.meta.dirname, "../../../.local/outbox")),
};

const TICK_MS = 60_000;

async function pass(): Promise<void> {
  const decision = await tick(deps);
  log("worker.pass", { decision });
}

if (process.argv.includes("--loop")) {
  log("worker.loop_start", { provider: provider.name });
  for (;;) {
    await pass().catch((err: unknown) => log("worker.pass_failed", errorInfo(err), "error"));
    await new Promise((resolve) => setTimeout(resolve, TICK_MS));
  }
} else {
  await pass().catch((err: unknown) => crash("worker.pass_failed", err));
}
