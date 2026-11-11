import type { FactLibrary } from "./facts";
import type { Seniority } from "./preferences";

/**
 * What a fact library says about someone's level and focus, read straight from the data with no
 * model call. Used to set sensible defaults at onboarding, which the person can change later.
 * Nothing here assumes an occupation.
 */

type Lib = Pick<FactLibrary, "entries" | "skills">;

const INTERN = /\b(intern|internship|trainee|apprentice)\b/i;

/** Words that put a title above an individual contributor in almost any field. "Staff" isn't one: a staff nurse is entry level. */
const ABOVE_IC = /\b(lead|principal|head|director|chief|vp|vice president|manager|supervisor)\b/i;

function monthIndex(s: string | undefined | null): number | null {
  if (!s) return null;
  const m = /^(\d{4})(?:-(\d{1,2}))?/.exec(s.trim());
  if (!m) return null;
  return Number(m[1]) * 12 + (m[2] ? Number(m[2]) - 1 : 0);
}

/** Years of paid work in the library's roles, overlaps counted once. Internships and traineeships don't count. */
export function experienceYears(lib: Pick<FactLibrary, "entries">, now: Date = new Date()): number {
  const nowIdx = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const spans: [number, number][] = [];
  for (const e of lib.entries) {
    if (e.kind !== "role" || INTERN.test(e.title)) continue;
    const start = monthIndex(e.start);
    if (start == null) continue;
    const end = e.end == null ? nowIdx : (monthIndex(e.end) ?? nowIdx);
    if (end >= start) spans.push([start, end + 1]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  let months = 0;
  let cur: [number, number] | null = null;
  for (const s of spans) {
    if (cur && s[0] <= cur[1]) cur[1] = Math.max(cur[1], s[1]);
    else {
      if (cur) months += cur[1] - cur[0];
      cur = [s[0], s[1]];
    }
  }
  if (cur) months += cur[1] - cur[0];
  return Math.round((months / 12) * 10) / 10;
}

/** True when the person has held a lead, manager or similar title, so such roles aren't above them. */
export function hasHeldSeniorTitle(lib: Pick<FactLibrary, "entries">): boolean {
  return lib.entries.some((e) => e.kind === "role" && ABOVE_IC.test(e.title));
}

export interface LevelDefaults {
  years: number;
  maxYearsRequired: number | null;
  excludeSeniority: Seniority[];
}

/**
 * Starting values for the years cap and seniority exclusions. A posting may ask for a little more
 * than someone has, so the cap is their years rounded up plus two. Empty library: no limits.
 */
export function levelDefaults(lib: Pick<FactLibrary, "entries">, now: Date = new Date()): LevelDefaults {
  const years = experienceYears(lib, now);
  if (years === 0) return { years, maxYearsRequired: null, excludeSeniority: [] };
  const senior = hasHeldSeniorTitle(lib);
  const exclude: Seniority[] = [];
  if (years >= 1) exclude.push("intern");
  if (!senior && years < 8) exclude.push("lead");
  if (years < 12) exclude.push("executive");
  return { years, maxYearsRequired: Math.ceil(years) + 2, excludeSeniority: exclude };
}

/** A suggested title above someone's level: a lead or manager title for a person who has never held one and has under 8 years. */
export function isAboveLevel(title: string, lib: Pick<FactLibrary, "entries">, ownTitles: string[] = [], now: Date = new Date()): boolean {
  if (!ABOVE_IC.test(title)) return false;
  if (hasHeldSeniorTitle(lib) || ownTitles.some((t) => ABOVE_IC.test(t))) return false;
  return experienceYears(lib, now) < 8;
}

/**
 * Search topics from the library: the tags and skills that come up most, with recent work counted
 * three times. Used when the person hasn't chosen topics of their own.
 */
export function topicsFromLibrary(lib: Lib, max = 8, now: Date = new Date()): string[] {
  const recentFrom = now.getUTCFullYear() * 12 + now.getUTCMonth() - 24;
  const weight = new Map<string, { label: string; w: number }>();
  const add = (raw: string, w: number) => {
    const label = raw.trim();
    if (!label || label.length > 40) return;
    const key = label.toLowerCase();
    const cur = weight.get(key);
    if (cur) cur.w += w;
    else weight.set(key, { label, w });
  };
  for (const e of lib.entries) {
    if (e.kind !== "role" && e.kind !== "project") continue;
    const end = e.end == null ? Infinity : (monthIndex(e.end) ?? 0);
    const w = end >= recentFrom ? 3 : 1;
    for (const t of e.tags) add(t, w);
  }
  for (const s of lib.skills) add(s, 1);
  return [...weight.values()]
    .sort((a, b) => b.w - a.w || a.label.localeCompare(b.label))
    .slice(0, max)
    .map((x) => x.label);
}
