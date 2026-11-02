import { z } from "zod";
import { Region } from "./regions";

export { Region } from "./regions";

export const WorkMode = z.enum(["remote", "hybrid", "onsite"]);
export type WorkMode = z.infer<typeof WorkMode>;

export const RemoteScope = z.enum([
  /** Only roles open to anyone anywhere. A country or region list disqualifies a role. */
  "worldwide_only",
  /** Roles open to anyone, or whose location list includes the user. */
  "eligible_regions",
  /** Any remote role. The user takes responsibility for eligibility. */
  "any",
]);
export type RemoteScope = z.infer<typeof RemoteScope>;

export const SalaryPeriod = z.enum(["hour", "day", "week", "month", "year"]);
export type SalaryPeriod = z.infer<typeof SalaryPeriod>;

export const Seniority = z.enum(["intern", "junior", "mid", "senior", "lead", "executive", "unknown"]);
export type Seniority = z.infer<typeof Seniority>;

export const CvConvention = z.enum(["standard", "north_america", "uk_commonwealth", "europe"]);
export const PageSize = z.enum(["A4", "LETTER"]);

/**
 * Per-user search preferences, produced by the onboarding form and stored as JSON
 * in `preferences.data`. Occupation, work mode and location all live here: nothing
 * in the code assumes any of them.
 */
export const PreferencesSchema = z.object({
  /** Ids from the `categories` table. Empty means any category. */
  categories: z.array(z.string().min(1)).default([]),
  targetTitles: z.array(z.string().min(1)).min(1),
  /** Fallback titles, generated from the user's titles at onboarding and editable. Searched only below minPicks. */
  expansionTitles: z
    .object({
      /** Tier A: close titles. */
      a: z.array(z.string()).default([]),
      /** Tier B: adjacent titles. */
      b: z.array(z.string()).default([]),
      /** Tier C: stretch titles. */
      c: z.array(z.string()).default([]),
    })
    .default({ a: [], b: [], c: [] }),

  workModes: z.array(WorkMode).min(1).default(["remote"]),
  /** How far remote roles may be limited. Ignored unless workModes includes remote. */
  remoteScope: RemoteScope.default("eligible_regions"),
  /** Where hybrid and on-site roles may be. Ignored unless workModes includes hybrid or onsite. */
  locations: z
    .object({
      countries: z.array(z.string().length(2)).default([]),
      /** When set, a hybrid or on-site role must be in one of these cities. */
      cities: z.array(z.string().min(1)).default([]),
    })
    .default({ countries: [], cities: [] }),

  eligibility: z.object({
    /** Where the user lives. ISO 3166-1 alpha-2. */
    country: z.string().length(2),
    /** Regions that country falls in. Prefilled at onboarding from regionsOfCountry. */
    regions: z.array(Region).default([]),
    utcOffsetHours: z.number().min(-12).max(14),
    /** Other countries where the user already holds the right to work. */
    workAuthorization: z.array(z.string().length(2)).default([]),
  }),

  /** Optional filter on where the employer is based. Null means any. */
  employerBase: z
    .object({
      countries: z.array(z.string().length(2)).default([]),
      regions: z.array(Region).default([]),
    })
    .nullable()
    .default(null),

  minSalary: z
    .object({
      amount: z.number().positive(),
      currency: z.string().length(3),
      period: SalaryPeriod,
    })
    .nullable()
    .default(null),
  /** Languages the user can work in. Empty disables the language gate. */
  languages: z.array(z.string().min(1)).default([]),

  excludeTitleKeywords: z.array(z.string()).default([]),
  /** Role types to reject, matched against the job's `roleTypes`, e.g. "sales" or "training_work". */
  excludeRoleTypes: z.array(z.string()).default([]),
  excludeSeniority: z.array(Seniority).default([]),
  /** Reject roles asking for more years than this. Null means no limit. */
  maxYearsRequired: z.number().int().min(0).max(50).nullable().default(null),
  maxPostingAgeDays: z.number().int().min(1).max(60).default(14),

  /** What to do with a role requiring a licence or credential the user's library doesn't have. */
  missingCredentialPolicy: z.enum(["hard_gate", "score_penalty"]).default("hard_gate"),

  minScore: z.number().min(0).max(10).default(7),
  minPicks: z.number().int().min(0).max(10).default(3),
  dailyCap: z.number().int().min(1).max(10).default(5),

  worthALookCount: z.number().int().min(0).max(10).default(3),
  worthALookMinScore: z.number().min(0).max(10).default(8),
  /** Near misses in these regions are listed first. Empty keeps score order. */
  worthALookPreferRegions: z.array(Region).default([]),

  cvTemplate: z
    .object({
      convention: CvConvention.default("standard"),
      pageSize: PageSize.default("A4"),
    })
    .default({ convention: "standard", pageSize: "A4" }),
});

export type Preferences = z.infer<typeof PreferencesSchema>;
export type PreferencesInput = z.input<typeof PreferencesSchema>;
