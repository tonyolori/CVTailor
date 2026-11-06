import { join } from "node:path";
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
  await pass();
}
