import type { EnrichedJob, JobSalary } from "./job";
import type { Preferences, SalaryPeriod } from "./preferences";
import { countryInRegion } from "./regions";

export type Gate =
  | "work_mode"
  | "location"
  | "employer_base"
  | "category"
  | "role_type"
  | "exclusion"
  | "seniority"
  | "age"
  | "closed"
  | "timezone"
  | "salary"
  | "credential"
  | "language";

export interface JobForMatch {
  title: string;
  enriched: EnrichedJob;
}

export interface GateContext {
  /** Credential names from the user's fact library. */
  credentials?: string[];
}

export interface GateResult {
  pass: boolean;
  failed: Gate[];
  reasons: string[];
  /** Things worth recording that didn't fail a gate, e.g. "salary unknown". */
  notes: string[];
  /** Required credentials the user's library doesn't have. A score penalty applies when the gate is off. */
  missingCredentials: string[];
  /** True when only location or work mode failed. Candidates for "worth a look" if they score high enough. */
  nearMiss: boolean;
}

export type LocationVerdict = "ok" | "excluded" | "unclear";

/**
 * Remote eligibility. Port of the "structured location list decides" rule.
 * Order matters: work-authorisation requirements and explicit country lists
 * beat a "worldwide" label, because aggregators and ATS descriptions get this wrong.
 */
export function locationVerdict(e: EnrichedJob, prefs: Preferences): LocationVerdict {
  if (prefs.remoteScope === "any") return "ok";

  const hasList = e.eligibleCountries.length > 0 || e.eligibleRegions.length > 0;
  const country = prefs.eligibility.country.toUpperCase();
  const authorised = new Set([country, ...prefs.eligibility.workAuthorization.map((c) => c.toUpperCase())]);

  if (e.requiresWorkAuthorization.length > 0) {
    if (!e.requiresWorkAuthorization.some((c) => authorised.has(c.toUpperCase()))) return "excluded";
  }

  if (prefs.remoteScope === "worldwide_only") {
    if (hasList) return "excluded";
    return e.worldwide ? "ok" : "unclear";
  }

  if (e.eligibleCountries.length > 0) {
    return e.eligibleCountries.some((c) => authorised.has(c.toUpperCase())) ? "ok" : "excluded";
  }
  if (e.eligibleRegions.length > 0) {
    const regions = new Set<string>(prefs.eligibility.regions);
    return e.eligibleRegions.some((r) => regions.has(r)) ? "ok" : "excluded";
  }
  return e.worldwide ? "ok" : "unclear";
}

function normPlace(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .toLowerCase();
}

/** Hybrid and on-site roles: the job's structured locations against the user's accepted places. */
export function placeVerdict(e: EnrichedJob, prefs: Preferences): LocationVerdict {
  if (e.locations.length === 0) return "unclear";
  const countries = new Set(prefs.locations.countries.map((c) => c.toUpperCase()));
  const cities = new Set(prefs.locations.cities.map(normPlace));
  const ok = e.locations.some((l) => {
    if (countries.size > 0 && !countries.has(l.country.toUpperCase())) return false;
    if (cities.size === 0) return countries.size > 0;
    return l.city != null && cities.has(normPlace(l.city));
  });
  return ok ? "ok" : "excluded";
}

const PER_YEAR: Record<SalaryPeriod, number> = { hour: 2080, day: 260, week: 52, month: 12, year: 1 };

/** Annualised comparison. Null when the posting's salary and the floor can't be compared. */
export function salaryMeetsFloor(salary: JobSalary | null, floor: Preferences["minSalary"]): boolean | null {
  if (!salary || !floor) return null;
  if (salary.currency.toUpperCase() !== floor.currency.toUpperCase()) return null;
  const top = salary.max ?? salary.min;
  if (top == null) return null;
  return top * PER_YEAR[salary.period] >= floor.amount * PER_YEAR[floor.period];
}

function normCredential(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Words that say what kind of credential it is, not which one. */
const GENERIC_CREDENTIAL_WORDS = new Set(
  "a an the of in and or for current active valid registration registered certificate certification certified licence license licensed pin number holder professional qualification qualified membership member".split(" "),
);

function significantWords(s: string): string[] {
  return normCredential(s)
    .split(" ")
    .filter((w) => w && !GENERIC_CREDENTIAL_WORDS.has(w));
}

/**
 * Required credentials with no counterpart in the user's library. A held credential counts
 * when it has every significant word of the required one, so "NMC PIN" is met by "NMC
 * Registration" but "NMC Midwifery Registration" isn't: holding a broader registration
 * never implies a narrower one. A pure kind-of-credential phrase with no significant words
 * can't be judged here, so it isn't reported as missing.
 */
export function findMissingCredentials(required: string[], held: string[]): string[] {
  const have = held.map(significantWords).filter((w) => w.length > 0);
  return required.filter((r) => {
    const need = significantWords(r);
    if (need.length === 0) return false;
    return !have.some((h) => need.every((w) => h.includes(w)));
  });
}

export function evaluateGates(
  job: JobForMatch,
  prefs: Preferences,
  now: Date = new Date(),
  ctx: GateContext = {},
): GateResult {
  const e = job.enriched;
  const failed: Gate[] = [];
  const reasons: string[] = [];
  const notes: string[] = [];
  const fail = (gate: Gate, reason: string) => {
    if (!failed.includes(gate)) failed.push(gate);
    reasons.push(reason);
  };

  if (!e.isOpen) fail("closed", "posting is closed");

  if (e.workMode === "unclear") {
    fail("work_mode", "work mode unclear");
  } else if (!prefs.workModes.includes(e.workMode)) {
    fail("work_mode", `work mode is ${e.workMode}`);
  }

  if (e.workMode === "remote") {
    if (prefs.workModes.includes("remote")) {
      const loc = locationVerdict(e, prefs);
      if (loc === "excluded") fail("location", "location list excludes the candidate");
      if (loc === "unclear") fail("location", "location eligibility unclear");
    }
    if (e.tzRestriction) {
      const off = prefs.eligibility.utcOffsetHours;
      if (off < e.tzRestriction.minUtcOffset || off > e.tzRestriction.maxUtcOffset) {
        fail("timezone", "time-zone window excludes the candidate");
      }
    }
  } else if (e.workMode === "hybrid" || e.workMode === "onsite") {
    const hasPlaces = prefs.locations.countries.length > 0 || prefs.locations.cities.length > 0;
    if (prefs.workModes.includes(e.workMode) || hasPlaces) {
      const loc = placeVerdict(e, prefs);
      if (loc === "excluded") fail("location", "role is outside the accepted locations");
      if (loc === "unclear") fail("location", "role location unclear");
    }
  }

  if (prefs.employerBase) {
    const { countries, regions } = prefs.employerBase;
    if (countries.length > 0 || regions.length > 0) {
      const base = e.employerBase;
      const baseCountry = base.country?.toUpperCase() ?? null;
      if (baseCountry == null && base.regions.length === 0) {
        // Postings often don't say. Unknown isn't a mismatch, so it stays in and gets recorded.
        notes.push("employer base unknown");
      } else {
        const ok =
          (baseCountry != null && countries.some((c) => c.toUpperCase() === baseCountry)) ||
          (baseCountry != null && regions.some((r) => countryInRegion(baseCountry, r))) ||
          base.regions.some((r) => regions.includes(r));
        if (!ok) fail("employer_base", `employer based in ${baseCountry ?? base.regions.join(", ")}`);
      }
    }
  }

  if (prefs.categories.length > 0 && e.category !== "other" && !prefs.categories.includes(e.category)) {
    fail("category", `category is ${e.category}`);
  }

  const excludedType = e.roleTypes.find((t) => prefs.excludeRoleTypes.includes(t));
  if (excludedType) fail("role_type", `excluded role type (${excludedType})`);
  if (e.isUnpaidOrFeeBased) fail("exclusion", "unpaid, commission-only or fee-based");

  const title = job.title.toLowerCase();
  const hit = prefs.excludeTitleKeywords.find((k) => {
    const kw = k.trim().toLowerCase();
    return kw && new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(kw)}(?![\\p{L}\\p{N}])`, "u").test(title);
  });
  if (hit) fail("exclusion", `title contains "${hit}"`);

  if (prefs.excludeSeniority.includes(e.seniority)) fail("seniority", `seniority is ${e.seniority}`);
  if (prefs.maxYearsRequired != null && e.maxYearsRequired != null && e.maxYearsRequired > prefs.maxYearsRequired) {
    fail("seniority", `asks for ${e.maxYearsRequired}+ years`);
  }

  if (!e.postedAt) {
    fail("age", "posting date unknown");
  } else {
    const ageDays = (now.getTime() - new Date(e.postedAt).getTime()) / 86_400_000;
    if (Number.isNaN(ageDays)) fail("age", "posting date unreadable");
    else if (ageDays > prefs.maxPostingAgeDays) fail("age", `posted ${Math.floor(ageDays)} days ago`);
  }

  if (prefs.minSalary) {
    const meets = salaryMeetsFloor(e.salary, prefs.minSalary);
    if (meets === false) fail("salary", "salary is below the floor");
    if (meets === null) notes.push("salary unknown");
  }

  const missingCredentials = findMissingCredentials(e.requiredCredentials, ctx.credentials ?? []);
  if (missingCredentials.length > 0) {
    if (prefs.missingCredentialPolicy === "hard_gate") {
      fail("credential", `requires ${missingCredentials.join(", ")}`);
    } else {
      notes.push(`missing credential: ${missingCredentials.join(", ")}`);
    }
  }

  if (prefs.languages.length > 0 && e.languagesRequired.length > 0) {
    const known = new Set(prefs.languages.map((l) => l.trim().toLowerCase()));
    const missing = e.languagesRequired.filter((l) => !known.has(l.trim().toLowerCase()));
    if (missing.length > 0) fail("language", `requires ${missing.join(", ")}`);
  }

  return {
    pass: failed.length === 0,
    failed,
    reasons,
    notes,
    missingCredentials,
    nearMiss: failed.length > 0 && failed.every((g) => g === "location" || g === "work_mode"),
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
