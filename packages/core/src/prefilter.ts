import type { Preferences, WorkMode } from "./preferences";
import { countryName } from "./regions";

/** Cheap fields every source can provide, before any LLM call. */
export interface PrefilterJob {
  title: string;
  locationText: string;
  workModeHint: WorkMode | null;
  postedAt: string | null;
}

export interface Category {
  id: string;
  keywords: string[];
}

const STOPWORDS = new Set(["and", "or", "of", "the", "a", "an", "in", "at", "for", "to", "with", "senior", "junior", "mid", "level", "i", "ii", "iii"]);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#.]+/gu, " ")
    .split(" ")
    .map((t) => t.replace(/^\.+|\.+$/g, ""))
    .filter((t) => t && !STOPWORDS.has(t));
}

function containsPhrase(haystack: string, phrase: string): boolean {
  const escaped = phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "u").test(haystack);
}

function titleHit(title: string, wanted: string[]): boolean {
  const have = new Set(tokens(title));
  return wanted.some((w) => {
    const parts = tokens(w);
    if (parts.length === 0) return false;
    const hits = parts.filter((p) => have.has(p)).length;
    return hits === parts.length || (parts.length >= 3 && hits >= parts.length - 1);
  });
}

export type TitleTier = "core" | "a" | "b" | "c";

/** Which of the user's title lists a posting's title falls in. Null when it matches none. */
export function titleTier(title: string, prefs: Preferences): TitleTier | null {
  if (titleHit(title, prefs.targetTitles)) return "core";
  if (titleHit(title, prefs.expansionTitles.a)) return "a";
  if (titleHit(title, prefs.expansionTitles.b)) return "b";
  if (titleHit(title, prefs.expansionTitles.c)) return "c";
  return null;
}

/** "target" is a close match to the user's main titles; "other" matches an expansion title or a category keyword. */
export function titleMatch(title: string, prefs: Preferences, categories: Category[]): "target" | "other" | null {
  if (titleHit(title, prefs.targetTitles)) return "target";
  if (titleHit(title, [...prefs.expansionTitles.a, ...prefs.expansionTitles.b, ...prefs.expansionTitles.c])) return "other";
  const lower = title.toLowerCase();
  const mine = categories.filter((c) => prefs.categories.includes(c.id));
  return mine.some((c) => c.keywords.some((k) => containsPhrase(lower, k))) ? "other" : null;
}

const REMOTE_TEXT = /\b(remote|anywhere|worldwide|work from home|wfh|telecommute|distributed|global)\b/i;
const HYBRID_TEXT = /\bhybrid\b/i;

function mentionsPlace(lower: string, cities: string[], countries: string[]): boolean {
  if (cities.some((c) => containsPhrase(lower, c))) return true;
  return countries.some((c) => containsPhrase(lower, countryName(c)) || containsPhrase(lower, c));
}

/**
 * Could this role's mode and place suit the user? Unknown stays in: the model decides later.
 * Near misses are kept only for the user's main titles, so "worth a look" stays possible
 * without enriching every role in the category. A physical role in another country isn't
 * a useful near miss, so it goes.
 */
export function placeMatches(job: PrefilterJob, prefs: Preferences, title: "target" | "other"): boolean {
  if (job.workModeHint == null && !job.locationText.trim()) return true;
  const nearMissOk = prefs.worthALookCount > 0 && title === "target";
  const lower = job.locationText.toLowerCase();
  const home = [prefs.eligibility.country, ...prefs.locations.countries];

  if (job.workModeHint === "remote" || REMOTE_TEXT.test(job.locationText)) {
    return prefs.workModes.includes("remote") || nearMissOk;
  }

  const hybrid = job.workModeHint === "hybrid" || HYBRID_TEXT.test(job.locationText);
  const physicalOk = prefs.workModes.includes(hybrid ? "hybrid" : "onsite");
  const { countries, cities } = prefs.locations;
  const exact = cities.length > 0 ? mentionsPlace(lower, cities, []) : mentionsPlace(lower, [], countries);
  if (physicalOk && exact) return true;
  // No recognisable place in the text, or a near miss in a country the user could reach.
  return nearMissOk && mentionsPlace(lower, cities, home);
}

export interface PrefilterResult {
  keep: boolean;
  reason?: "age" | "title" | "place";
}

/** Keep a posting if at least one active user could want it. Costs nothing per posting. */
export function prefilter(
  job: PrefilterJob,
  users: Preferences[],
  categories: Category[],
  now: Date = new Date(),
): PrefilterResult {
  let reason: PrefilterResult["reason"] = "title";
  const posted = job.postedAt ? new Date(job.postedAt).getTime() : NaN;
  const ageDays = (now.getTime() - posted) / 86_400_000;

  for (const prefs of users) {
    if (!Number.isNaN(ageDays) && ageDays > prefs.maxPostingAgeDays) {
      reason = "age";
      continue;
    }
    const title = titleMatch(job.title, prefs, categories);
    if (!title) continue;
    if (!placeMatches(job, prefs, title)) {
      reason = "place";
      continue;
    }
    return { keep: true };
  }
  return { keep: false, reason };
}
