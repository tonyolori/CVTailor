import { bodyErrorCode, errorFields, safeLogFields, type LogField } from "@cvtailor/core/log";

export { bodyErrorCode, errorFields };

export type LogLevel = "info" | "warn" | "error";
type Fields = Record<string, LogField>;

/**
 * One JSON line of ids and counts on the console: the host's runtime logs on the server, the
 * browser's console in a client component. Personal text is refused, as in the worker's log().
 */
export function log(event: string, fields: Fields = {}, level: LogLevel = "info"): void {
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...safeLogFields(fields) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function target(input: RequestInfo | URL): { host?: string; path: string } {
  const PLACEHOLDER = "relative.invalid";
  try {
    const url = new URL(input instanceof Request ? input.url : String(input), `http://${PLACEHOLDER}`);
    return { host: url.host === PLACEHOLDER ? undefined : url.host, path: url.pathname };
  } catch {
    return { path: "unparseable" };
  }
}

/**
 * `fetch`, with each request's outcome logged. The query string is left out, because Supabase
 * filters put values like email addresses there. Bodies are never logged.
 */
export const loggedFetch: typeof fetch = async (input, init) => {
  const started = Date.now();
  const request = { method: init?.method ?? (input instanceof Request ? input.method : "GET"), ...target(input) };
  try {
    const res = await fetch(input, init);
    const ms = Date.now() - started;
    if (res.ok) log("http.response", { ...request, status: res.status, ms });
    else log("http.response", { ...request, status: res.status, ms, code: bodyErrorCode(await res.clone().json().catch(() => null)) }, res.status >= 500 ? "error" : "warn");
    return res;
  } catch (err) {
    const ms = Date.now() - started;
    if (err instanceof Error && err.name === "AbortError") log("http.cancelled", { ...request, ms });
    else log("http.failed", { ...request, ms, ...errorFields(err) }, "error");
    throw err;
  }
};

/** redirect() and notFound() end a request by throwing. Neither is a failure. */
function frameworkSignal(err: unknown): string | undefined {
  const digest = (err as { digest?: unknown } | null)?.digest;
  if (typeof digest !== "string") return undefined;
  if (digest.startsWith("NEXT_REDIRECT")) return "redirect";
  return /^(NEXT_|DYNAMIC_SERVER_USAGE|BAILOUT_TO)/.test(digest) ? "framework" : undefined;
}

async function responseFields(res: Response): Promise<{ level: LogLevel; fields: Fields }> {
  let reason: string | undefined;
  if (res.status >= 400) {
    const body = (await res.clone().json().catch(() => null)) as { error?: unknown } | null;
    reason = typeof body?.error === "string" ? body.error : undefined;
  } else if (res.status >= 300) {
    // Only this part: where a good redirect goes can hold a token, such as a payment link.
    const location = res.headers.get("location");
    reason = location ? (new URL(location, "http://relative.invalid").searchParams.get("error") ?? undefined) : undefined;
  }
  const level = res.status >= 500 ? "error" : res.status >= 400 || reason ? "warn" : "info";
  return { level, fields: { status: res.status, reason } };
}

/**
 * Wraps a route handler or server action, so each one logs how it ended: its status, and the
 * reason it gave the user when it failed. What it returns or throws passes through unchanged.
 */
export function logged<A extends unknown[], R>(op: string, fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return async (...args: A): Promise<R> => {
    const started = Date.now();
    try {
      const result = await fn(...args);
      const ms = Date.now() - started;
      if (result instanceof Response) {
        const { level, fields } = await responseFields(result);
        log("op.done", { op, ms, ...fields }, level);
      } else if ((result as { ok?: unknown } | null | undefined)?.ok === false) {
        log("op.done", { op, ms, outcome: "failed", reason: (result as { message?: string }).message }, "warn");
      } else {
        log("op.done", { op, ms });
      }
      return result;
    } catch (err) {
      const ms = Date.now() - started;
      const signal = frameworkSignal(err);
      if (signal) log("op.done", { op, ms, outcome: signal });
      else log("op.threw", { op, ms, ...errorFields(err) }, "error");
      throw err;
    }
  };
}
