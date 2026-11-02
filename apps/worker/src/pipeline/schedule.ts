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

export type RunDecision = "run" | "done" | "busy" | "too_early";

export function decideRun(
  existing: { status: string; started_at: string } | null,
  now: Date,
  startHourUtc: number,
): RunDecision {
  if (existing?.status === "ok") return "done";
  if (existing?.status === "running" && now.getTime() - new Date(existing.started_at).getTime() < STALE_RUN_MS) return "busy";
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

/** Free-plan weekly digest day: Monday, in the user's own zone. */
export function isDigestDay(now: Date, tzRaw: string): boolean {
  return new Intl.DateTimeFormat("en-US", { timeZone: validZone(tzRaw), weekday: "short" }).format(now) === "Mon";
}
