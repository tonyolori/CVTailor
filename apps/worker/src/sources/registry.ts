import { countryName, type Preferences } from "@cvtailor/core";
import { AGGREGATORS } from "./aggregators";
import type { CompanyRow } from "./ats";
import type { SourceAdapter } from "./types";

export interface RegistryOptions {
  /** Paid plans are live, so sources whose free tier excludes commercial use are off. */
  billingEnforced: boolean;
  /** Ids of sources with unverified terms that Tony has explicitly turned on. */
  enabledUnverified?: string[];
}

export function allowedByTerms(a: SourceAdapter, opts: RegistryOptions): boolean {
  if (a.terms.blockedWhenPaid && opts.billingEnforced) return false;
  if (a.terms.status === "unverified") return opts.enabledUnverified?.includes(a.id) ?? false;
  return true;
}

/**
 * Every feed the terms allow, whoever is signed up. Fetching costs no AI, only polite request time,
 * and the pre-filter still stores only postings someone could want.
 */
export function usableAdapters(opts: RegistryOptions, adapters: SourceAdapter[] = AGGREGATORS): SourceAdapter[] {
  return adapters.filter((a) => allowedByTerms(a, opts));
}

export interface SourceGap {
  workMode: string;
  message: string;
}

/**
 * Says plainly when no source can serve part of what a user asked for, so an empty result
 * isn't mistaken for "no jobs today".
 */
export function coverageGaps(prefs: Preferences, opts: RegistryOptions, companies: CompanyRow[], adapters: SourceAdapter[] = AGGREGATORS): SourceGap[] {
  const gaps: SourceGap[] = [];
  const usable = adapters.filter((a) => allowedByTerms(a, opts));
  const categorised = (a: SourceAdapter) => a.categories === "*" || prefs.categories.length === 0 || a.categories.some((c) => prefs.categories.includes(c));

  if (prefs.workModes.includes("remote") && !usable.some((a) => a.workModes.includes("remote") && categorised(a))) {
    gaps.push({ workMode: "remote", message: "No job source covers remote roles in your field yet." });
  }

  for (const mode of ["hybrid", "onsite"] as const) {
    if (!prefs.workModes.includes(mode)) continue;
    const places = [...prefs.locations.cities, ...prefs.locations.countries.map(countryName)];
    const where = places.length ? ` in ${places.join(", ")}` : "";
    const countries = new Set(prefs.locations.countries.map((c) => c.toUpperCase()));
    const boards = companies.filter(
      (c) =>
        (c.tags.length === 0 || c.tags.some((t) => prefs.categories.includes(t))) &&
        (countries.size === 0 || c.countries.some((k) => countries.has(k.toUpperCase()))),
    );
    const feeds = usable.some((a) => a.workModes.includes(mode) && categorised(a) && adapterServesCountry(a, countries));
    if (!feeds && boards.length === 0) {
      gaps.push({
        workMode: mode,
        message: `No job source covers ${mode === "onsite" ? "on-site" : "hybrid"} roles in your field${where} yet, so this search can't return results for them. This isn't the same as there being no jobs.`,
      });
    }
  }
  return gaps;
}

function adapterServesCountry(a: SourceAdapter, countries: Set<string>): boolean {
  return a.countries === "*" || countries.size === 0 || a.countries.some((c) => countries.has(c.toUpperCase()));
}

const MAX_QUERIES = 40;

/**
 * What to search, de-duplicated across users, most important first: main titles, then each user's
 * search topics, then fallback titles. `topics[i]` belongs to `users[i]`.
 */
export function searchQueries(users: Preferences[], topics: string[][] = []): string[] {
  const seen = new Map<string, string>();
  const add = (t: string) => {
    const key = t.trim().toLowerCase();
    if (key && !seen.has(key)) seen.set(key, t.trim());
  };
  users.forEach((u) => u.targetTitles.forEach(add));
  topics.forEach((t) => t.forEach(add));
  users.forEach((u) => u.expansionTitles.a.forEach(add));
  users.forEach((u) => u.expansionTitles.b.forEach(add));
  users.forEach((u) => u.expansionTitles.c.forEach(add));
  return [...seen.values()].slice(0, MAX_QUERIES);
}

/** First-pass searches: main titles and topics only. Fallback titles are searched later, for users short of picks. */
export function primaryQueries(users: Preferences[], topics: string[][] = []): string[] {
  return searchQueries(
    users.map((u) => ({ ...u, expansionTitles: { a: [], b: [], c: [] } })),
    topics,
  );
}

/** Fallback-title searches for users below their minimum picks, minus what the first pass searched. */
export function fallbackQueries(users: Preferences[], alreadySearched: string[]): string[] {
  const done = new Set(alreadySearched.map((q) => q.trim().toLowerCase()));
  return searchQueries(users.map((u) => ({ ...u, targetTitles: [] }))).filter((q) => !done.has(q.toLowerCase()));
}
