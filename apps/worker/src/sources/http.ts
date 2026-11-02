import { log } from "../log";

export interface Http {
  json<T = unknown>(url: string): Promise<T | null>;
  text(url: string): Promise<string | null>;
}

export type FetchFn = typeof fetch;

export interface HostPolicy {
  /** Minimum gap between requests to one host. */
  minIntervalMs: number;
}

const DEFAULT_INTERVAL_MS = 500;
const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 30_000;
const USER_AGENT = "JobTailor/0.1 (invite-only personal job search; polite polling)";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The legacy scanner's fetch etiquette: one request at a time per host, a pause between
 * requests, and backoff on 401 and 429 (Ashby answers 401 to bursts). Null means the
 * resource couldn't be read; callers decide what that means.
 */
export function politeHttp(
  policies: Record<string, HostPolicy> = {},
  fetchFn: FetchFn = fetch,
  pause: (ms: number) => Promise<void> = sleep,
): Http {
  const nextAllowed = new Map<string, number>();
  const queues = new Map<string, Promise<unknown>>();

  async function request(url: string, accept: string): Promise<Response | null> {
    const host = new URL(url).host;
    const interval = policies[host]?.minIntervalMs ?? DEFAULT_INTERVAL_MS;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const wait = (nextAllowed.get(host) ?? 0) - Date.now();
      if (wait > 0) await pause(wait);
      nextAllowed.set(host, Date.now() + interval);
      try {
        const res = await fetchFn(url, {
          headers: { "user-agent": USER_AGENT, accept },
          redirect: "follow",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (res.ok) return res;
        if (res.status === 401 || res.status === 429 || res.status >= 500) {
          const retryAfter = Number(res.headers.get("retry-after"));
          const backoff = retryAfter > 0 ? retryAfter * 1000 : 2000 * attempt * attempt;
          log("http.backoff", { host, status: res.status, attempt });
          if (attempt < MAX_ATTEMPTS) await pause(backoff);
          continue;
        }
        return null;
      } catch {
        if (attempt < MAX_ATTEMPTS) await pause(1000 * attempt);
      }
    }
    return null;
  }

  // Serialize per host so concurrent adapters can't burst one host between them.
  function serial<T>(url: string, run: () => Promise<T>): Promise<T> {
    const host = new URL(url).host;
    const prev = queues.get(host) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(run);
    queues.set(host, next);
    return next;
  }

  return {
    json: <T>(url: string) =>
      serial(url, async () => {
        const res = await request(url, "application/json");
        if (!res) return null;
        try {
          return (await res.json()) as T;
        } catch {
          return null;
        }
      }),
    text: (url: string) =>
      serial(url, async () => {
        const res = await request(url, "text/html, application/xml, text/plain");
        return res ? res.text() : null;
      }),
  };
}
