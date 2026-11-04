import { countryName, type Preferences } from "@cvtailor/core";
import { AGGREGATORS } from "./aggregators";
import { companyRelevant, type CompanyRow } from "./ats";
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

export function adapterServes(a: Pick<SourceAdapter, "countries" | "categories" | "workModes">, prefs: Preferences): boolean {
  if (!a.workModes.some((m) => prefs.workModes.includes(m))) return false;
  if (a.categories !== "*" && prefs.categories.length > 0 && !a.categories.some((c) => prefs.categories.includes(c))) return false;
  if (a.countries === "*") return true;
  const wanted = new Set([prefs.eligibility.country, ...prefs.locations.countries].map((c) => c.toUpperCase()));
  return a.countries.some((c) => wanted.has(c.toUpperCase()));
}

/** Only adapters at least one active user needs. Cost must not grow with sources nobody uses. */
export function relevantAdapters(users: Preferences[], opts: RegistryOptions, adapters: SourceAdapter[] = AGGREGATORS): SourceAdapter[] {
  return adapters.filter((a) => allowedByTerms(a, opts) && users.some((u) => adapterServes(a, u)));
}

/** The companies whose boards are worth scanning for these users. */
export function relevantCompanies(companies: CompanyRow[], users: Preferences[]): CompanyRow[] {
  const tags = new Set(users.flatMap((u) => u.categories));
  const anyRemote = users.some((u) => u.workModes.includes("remote"));
  const countries = new Set(users.flatMap((u) => [u.eligibility.country, ...u.locations.countries]).map((c) => c.toUpperCase()));
  return companies.filter((c) => companyRelevant(c, tags, anyRemote ? "*" : countries));
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

const MAX_QUERIES = 30;

/** Titles to search, de-duplicated across users, main titles first. */
export function searchQueries(users: Preferences[]): string[] {
  const seen = new Map<string, string>();
  const add = (t: string) => {
    const key = t.trim().toLowerCase();
    if (key && !seen.has(key)) seen.set(key, t.trim());
  };
  users.forEach((u) => u.targetTitles.forEach(add));
  users.forEach((u) => u.expansionTitles.a.forEach(add));
  users.forEach((u) => u.expansionTitles.b.forEach(add));
  users.forEach((u) => u.expansionTitles.c.forEach(add));
  return [...seen.values()].slice(0, MAX_QUERIES);
}
