import { bodyErrorCode, errorFields, exceptionField, exceptionOf, safeLogFields, type LogField } from "@cvtailor/core/log";
import { raiseAlert } from "@cvtailor/core/alert";
import { sleeps } from "./sleep";

export type LogLevel = "info" | "warn" | "error";

/**
 * Structured log line of ids and counts only. An error just after the Mac woke says so, in the
 * line and in the alert's heading, as the sleep is the likely cause rather than the code.
 */
export function log(event: string, fields: Record<string, LogField> = {}, level: LogLevel = "info"): void {
  const given = typeof fields.pcSlept === "string" ? fields.pcSlept : undefined;
  const pcSlept = given ?? (level === "error" ? sleeps.note() : undefined);
  const safe = safeLogFields(pcSlept ? { ...fields, pcSlept } : fields);
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...safe });
  if (level === "error") {
    console.error(line);
    raiseAlert(pcSlept ? `${event} (PC was asleep)` : event, safe, exceptionOf(fields));
  } else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** Waits before each retry. Long enough for a dropped Wi-Fi or hotspot to come back. */
const DB_RETRY_PAUSES_MS = [2_000, 10_000, 30_000];

/** Failures before the request left this machine, so sending it again can't apply it twice. */
const NOT_SENT = new Set(["UND_ERR_CONNECT_TIMEOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH"]);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * `fetch` for the database client. Logs failures only: the task loop polls every few seconds,
 * and most of what it reads is "nothing to do". Filter values are in the query string, so it's left out.
 * A network failure is retried, as one lost request would otherwise fail the whole day's run. A plain
 * insert is retried only when it never went out, as it may otherwise have landed.
 */
export function dbFetch(pause: (ms: number) => Promise<void> = sleep): typeof fetch {
  return async (input, init) => {
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
    const upsert = /resolution=/.test(new Headers(init?.headers).get("prefer") ?? "");
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(input, init);
        if (!res.ok) log("db.response", { method, path, status: res.status, code: bodyErrorCode(await res.clone().json().catch(() => null)) }, res.status >= 500 ? "error" : "warn");
        return res;
      } catch (err) {
        const { errorType, code, at } = errorFields(err);
        const resendable = method !== "POST" || upsert || NOT_SENT.has(code ?? "");
        const retry = resendable && !(input instanceof Request) && !init?.signal?.aborted && attempt <= DB_RETRY_PAUSES_MS.length;
        if (retry) {
          log("db.retry", { method, path, kind: errorType, code, attempt }, "warn");
          await pause(DB_RETRY_PAUSES_MS[attempt - 1]!);
          continue;
        }
        log("db.failed", { method, path, kind: errorType, code, at, attempts: attempt, ...exceptionField(err) }, "error");
        throw err;
      }
    }
  };
}

export const failureLoggingFetch = dbFetch();
