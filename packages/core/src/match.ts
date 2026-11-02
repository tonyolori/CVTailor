import type { EnrichedJob } from "./job";
import type { Preferences } from "./preferences";

export type Gate =
  | "remote"
  | "location"
  | "company_base"
  | "role"
  | "exclusion"
  | "seniority"
  | "age"
  | "closed"
  | "timezone";

export interface JobForMatch {
  title: string;
  enriched: EnrichedJob;
}

export interface GateResult {
  pass: boolean;
  failed: Gate[];
  reasons: string[];
  /**
   * True when location is the only gate that failed. These roles are candidates
   * for the "worth a look" list if the LLM score is high enough.
   */
  locationOnly: boolean;
}

export type LocationVerdict = "ok" | "excluded" | "unclear";

/**
 * Port of the "structured location list decides" rule.
 * Order matters: work-authorisation requirements and explicit country lists
 * beat a "worldwide" label, because aggregators and ATS descriptions get this wrong.
 */
export function locationVerdict(e: EnrichedJob, prefs: Preferences): LocationVerdict {
  const country = prefs.eligibility.country.toUpperCase();
  const regions = new Set<string>(prefs.eligibility.regions);

  const auth = e.requiresWorkAuthorization.map((c) => c.toUpperCase());
  if (auth.length > 0 && !auth.includes(country)) return "excluded";

  if (e.eligibleCountries.length > 0) {
    return e.eligibleCountries.map((c) => c.toUpperCase()).includes(country) ? "ok" : "excluded";
  }
  if (e.eligibleRegions.length > 0) {
    return e.eligibleRegions.some((r) => regions.has(r)) ? "ok" : "excluded";
  }
  if (e.worldwide) return "ok";
  return "unclear";
}

const EXCLUDED_ROLE_FAMILIES = new Set(["research", "sales", "data_labelling"]);

export function evaluateGates(
  job: JobForMatch,
  prefs: Preferences,
  now: Date = new Date(),
): GateResult {
  const e = job.enriched;
  const failed: Gate[] = [];
  const reasons: string[] = [];
  const fail = (gate: Gate, reason: string) => {
    failed.push(gate);
    reasons.push(reason);
  };

  if (!e.isOpen) fail("closed", "posting is closed");

  if (e.remoteType !== "remote") fail("remote", `work type is ${e.remoteType}`);

  const loc = locationVerdict(e, prefs);
  if (loc === "excluded") fail("location", "location list excludes the candidate's country");
  if (loc === "unclear") fail("location", "location eligibility unclear");

  if (!prefs.companyBase.includes("any") && !prefs.companyBase.some((b) => b === e.companyHq)) {
    fail("company_base", `company based in ${e.companyHq}`);
  }

  if (e.tzRestriction) {
    const off = prefs.eligibility.utcOffsetHours;
    if (off < e.tzRestriction.minUtcOffset || off > e.tzRestriction.maxUtcOffset) {
      fail("timezone", "time-zone window excludes the candidate");
    }
  }

  if (EXCLUDED_ROLE_FAMILIES.has(e.roleFamily) || e.isTrainingWork) {
    fail("role", `excluded role type (${e.isTrainingWork ? "training work" : e.roleFamily})`);
  }
  if (e.isUnpaidOrFeeBased) fail("exclusion", "unpaid, commission-only or fee-based");

  const title = job.title.toLowerCase();
  const hit = prefs.excludeTitleKeywords.find((k) => {
    const kw = k.trim().toLowerCase();
    return kw && new RegExp(`\\b${escapeRegExp(kw)}\\b`).test(title);
  });
  if (hit) fail("exclusion", `title contains "${hit}"`);

  if (e.seniority === "staff_plus") fail("seniority", "staff or above");
  if (e.maxYearsRequired != null && e.maxYearsRequired > prefs.maxYearsRequired) {
    fail("seniority", `asks for ${e.maxYearsRequired}+ years`);
  }

  if (!e.postedAt) {
    fail("age", "posting date unknown");
  } else {
    const ageDays = (now.getTime() - new Date(e.postedAt).getTime()) / 86_400_000;
    if (Number.isNaN(ageDays)) fail("age", "posting date unreadable");
    else if (ageDays > prefs.maxPostingAgeDays) fail("age", `posted ${Math.floor(ageDays)} days ago`);
  }

  return {
    pass: failed.length === 0,
    failed,
    reasons,
    locationOnly: failed.length > 0 && failed.every((g) => g === "location"),
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
