import { z } from "zod";
import { Region, SalaryPeriod, Seniority } from "./preferences";

export const JobLocationSchema = z.object({
  /** ISO 3166-1 alpha-2. */
  country: z.string().length(2),
  region: z.string().nullable().default(null),
  city: z.string().nullable().default(null),
});
export type JobLocation = z.infer<typeof JobLocationSchema>;

export const JobSalarySchema = z.object({
  min: z.number().nullable().default(null),
  max: z.number().nullable().default(null),
  currency: z.string().length(3),
  period: SalaryPeriod,
});
export type JobSalary = z.infer<typeof JobSalarySchema>;

/**
 * Structured view of one posting, produced once per posting by a cheap LLM call
 * and shared by every user. The matcher works only from these fields.
 */
export const EnrichedJobSchema = z.object({
  isOpen: z.boolean(),
  /** ISO date from the employer's ATS when known, not the aggregator's repost date. */
  postedAt: z.string().nullable().default(null),

  workMode: z.enum(["remote", "hybrid", "onsite", "unclear"]),

  /** True only when the posting and its structured location fields say anyone anywhere may apply. */
  worldwide: z.boolean().default(false),
  /** Remote eligibility: ISO alpha-2 codes from a structured location list. When present, this list decides. */
  eligibleCountries: z.array(z.string().length(2)).default([]),
  eligibleRegions: z.array(Region).default([]),
  /** Countries where the candidate must already hold work authorisation or residency. */
  requiresWorkAuthorization: z.array(z.string().length(2)).default([]),
  /** Allowed UTC offsets for the worker, if the posting restricts them. */
  tzRestriction: z.object({ minUtcOffset: z.number(), maxUtcOffset: z.number() }).nullable().default(null),
  /** Physical places the role is tied to. Decides hybrid and on-site matching. */
  locations: z.array(JobLocationSchema).default([]),
  /** The posting's exact words about location, kept for the summary and for audits. */
  locationQuote: z.string().default(""),

  employerBase: z
    .object({
      country: z.string().length(2).nullable().default(null),
      regions: z.array(Region).default([]),
    })
    .default({ country: null, regions: [] }),

  /** Id from the `categories` table, or "other" when none fits. */
  category: z.string().default("other"),
  occupationTitle: z.string().default(""),
  /** Generic tags such as "sales", "research", "training_work", "gig", "internship". Users exclude these per preference. */
  roleTypes: z.array(z.string()).default([]),
  seniority: Seniority.default("unknown"),
  maxYearsRequired: z.number().nullable().default(null),

  salary: JobSalarySchema.nullable().default(null),
  /** Licences, registrations, certifications or degrees the posting requires. */
  requiredCredentials: z.array(z.string()).default([]),
  languagesRequired: z.array(z.string()).default([]),

  /** Unpaid, equity-only, commission-only, or asks the candidate for a fee. */
  isUnpaidOrFeeBased: z.boolean().default(false),

  mustHaves: z.array(z.string()).default([]),
  niceToHaves: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  /** Anything in the posting that tells applicants to do something specific. Surfaced, never obeyed. */
  applicantInstructions: z.array(z.string()).default([]),
  asksForCoverLetter: z.boolean().default(false),
});

export type EnrichedJob = z.infer<typeof EnrichedJobSchema>;
export type EnrichedJobInput = z.input<typeof EnrichedJobSchema>;

export const JobStatus = z.enum(["new", "filtered", "enriched", "verified", "closed", "failed"]);
export type JobStatus = z.infer<typeof JobStatus>;
