import { log } from "../log";

/** Offset of a time zone from UTC at a given instant, in milliseconds. */
function zoneOffsetMs(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

function validZone(tz: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    log("schedule.bad_timezone", {}, "warn");
    return "UTC";
  }
}

/** The instant a wall-clock time occurs in a zone. Handles daylight-saving offsets. */
export function zonedTimeToUtc(y: number, m: number, d: number, h: number, min: number, tz: string): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, h, min));
  const first = zoneOffsetMs(guess, tz);
  const second = zoneOffsetMs(new Date(guess.getTime() - first), tz);
  return new Date(guess.getTime() - second);
}

/**
 * When today's email goes out: the user's send_time today in their zone. If that has
 * already passed, because the run finished late, the email goes now rather than tomorrow.
 */
export function sendAtFor(now: Date, tzRaw: string, sendTime: string): Date {
  const tz = validZone(tzRaw);
  const local = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const [y, m, d] = local.split("-").map(Number) as [number, number, number];
  const [h, min] = sendTime.split(":").map(Number) as [number, number];
  const at = zonedTimeToUtc(y, m, d, h, min, tz);
  return at.getTime() > now.getTime() ? at : now;
}

/** Stale after this long: the worker that held it died, so another may take over. */
export const STALE_RUN_MS = 4 * 60 * 60 * 1000;

/**
 * A failed run waits this long from its start before trying again. Each try scans every board, and
 * the loop passes once a minute, so retrying at once would hammer employers' boards.
 */
export const RETRY_FAILED_MS = 30 * 60 * 1000;

export type RunDecision = "run" | "done" | "busy" | "too_early" | "retry_later";

export function decideRun(
  existing: { status: string; started_at: string } | null,
  now: Date,
  startHourUtc: number,
): RunDecision {
  if (existing?.status === "ok") return "done";
  if (existing?.status === "running" && now.getTime() - new Date(existing.started_at).getTime() < STALE_RUN_MS) return "busy";
  if (existing?.status === "failed" && now.getTime() - new Date(existing.started_at).getTime() < RETRY_FAILED_MS) return "retry_later";
  if (!existing && now.getUTCHours() < startHourUtc) return "too_early";
  return "run";
}

/** No run finished by the alert hour. Once a day only. */
export function shouldAlert(
  existing: { status: string; alert_sent_at: string | null } | null,
  now: Date,
  alertHourUtc: number,
): boolean {
  if (now.getUTCHours() < alertHourUtc) return false;
  if (existing?.status === "ok") return false;
  return !existing?.alert_sent_at;
}

/** How far back the worker looks for days it never ran. */
export const MISSED_LOOKBACK_DAYS = 7;

/**
 * Days with no run row at all, from the day after the first recorded run up to yesterday. A day
 * before the service's first run isn't missed, so a new install raises nothing.
 */
export function missedDays(recorded: string[], today: string, lookbackDays = MISSED_LOOKBACK_DAYS): string[] {
  if (recorded.length === 0) return [];
  const have = new Set(recorded);
  const first = [...recorded].sort()[0]!;
  const out: string[] = [];
  const day = new Date(`${today}T00:00:00Z`);
  for (let i = lookbackDays; i >= 1; i--) {
    const d = new Date(day.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    if (d > first && !have.has(d)) out.push(d);
  }
  return out;
}
