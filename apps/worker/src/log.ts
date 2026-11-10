import { bodyErrorCode, errorFields, safeLogFields, type LogField } from "@cvtailor/core/log";
import { raiseAlert } from "@cvtailor/core/alert";

export type LogLevel = "info" | "warn" | "error";

/** Structured log line of ids and counts only. */
export function log(event: string, fields: Record<string, LogField> = {}, level: LogLevel = "info"): void {
  const safe = safeLogFields(fields);
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...safe });
  if (level === "error") {
    console.error(line);
    raiseAlert(event, safe);
  } else if (level === "warn") console.warn(line);
  else console.log(line);
}

/**
 * `fetch` for the database client. Logs failures only: the task loop polls every few seconds,
 * and most of what it reads is "nothing to do". Filter values are in the query string, so it's left out.
 */
export const failureLoggingFetch: typeof fetch = async (input, init) => {
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
  try {
    const res = await fetch(input, init);
    if (!res.ok) log("db.response", { method, path, status: res.status, code: bodyErrorCode(await res.clone().json().catch(() => null)) }, res.status >= 500 ? "error" : "warn");
    return res;
  } catch (err) {
    const { errorType, code, at } = errorFields(err);
    log("db.failed", { method, path, kind: errorType, code, at }, "error");
    throw err;
  }
};
