/**
 * Dates as people say them: "Today", "Yesterday", "3 days ago", then "10 November". The exact date
 * and time goes in a hover title, through `exactDate`.
 */

const DAY = 86_400_000;

/** A plain date ("2026-11-10") is a calendar day, not a moment, so it's read in UTC. */
function parse(value: string | Date): { at: Date; dateOnly: boolean } {
  if (value instanceof Date) return { at: value, dateOnly: false };
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  return { at: new Date(dateOnly ? `${value}T00:00:00Z` : value), dateOnly };
}

function dayNumber(d: Date, utc: boolean, timeZone?: string): number {
  if (utc) return Math.floor(d.getTime() / DAY);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return Math.floor(new Date(`${parts}T00:00:00Z`).getTime() / DAY);
}

export function dateInWords(value: string | Date, now: Date = new Date(), timeZone?: string): string {
  const { at, dateOnly } = parse(value);
  if (Number.isNaN(at.getTime())) return "Unknown";
  const tz = dateOnly ? "UTC" : timeZone;
  const days = dayNumber(now, false, tz) - dayNumber(at, dateOnly, timeZone);
  const time = dateOnly ? "" : `, ${at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone })}`;
  if (days === 0) return `Today${time}`;
  if (days === 1) return `Yesterday${time}`;
  if (days > 1 && days < 7) return `${days} days ago`;
  const sameYear = at.getUTCFullYear() === now.getUTCFullYear();
  return at.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: sameYear ? undefined : "numeric", timeZone: tz });
}

/** The full date, and the time when there is one, for a hover title. */
export function exactDate(value: string | Date, timeZone?: string): string {
  const { at, dateOnly } = parse(value);
  if (Number.isNaN(at.getTime())) return "";
  return dateOnly
    ? at.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    : at.toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone, timeZoneName: "short" });
}
