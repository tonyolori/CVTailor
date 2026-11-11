import { errorFields, log } from "./lib/log";

/** Next calls this once per server. Error-level log lines also go to Slack when a webhook is set. */
export async function register(): Promise<void> {
  const webhookUrl = process.env.SLACK_ALERT_WEBHOOK_URL;
  if (process.env.NEXT_RUNTIME !== "nodejs" || !webhookUrl) return;
  const [{ setAlertSink, slackAlerts }, { waitUntil }] = await Promise.all([import("@cvtailor/core/alert"), import("@vercel/functions")]);
  const context = [
    process.env.VERCEL_REGION && `region ${process.env.VERCEL_REGION}`,
    process.env.VERCEL_GIT_COMMIT_SHA && `commit ${process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)}`,
    process.env.VERCEL_DEPLOYMENT_ID && `deployment ${process.env.VERCEL_DEPLOYMENT_ID}`,
    `node ${process.version}`,
  ].filter((part): part is string => Boolean(part));
  setAlertSink(slackAlerts({ webhookUrl, source: `web (${process.env.VERCEL_ENV ?? "local"})`, context, keepAlive: waitUntil }));
}

/** Next calls this for any uncaught server error, including page renders that nothing else wraps. */
export function onRequestError(err: unknown, request: { path: string; method: string }, context: { routerKind: string; routePath?: string; routeType: string }): void {
  log("request.error", { method: request.method, path: request.path.split("?")[0], routePath: context.routePath, routeType: context.routeType, ...errorFields(err) }, "error");
}
