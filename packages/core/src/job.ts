import { z } from "zod";
import { Region } from "./preferences";

/**
 * Structured view of one posting, produced once per posting by a cheap LLM call
 * and shared by every user. The matcher works only from these fields.
 */
export const EnrichedJobSchema = z.object({
  isOpen: z.boolean(),
  postedAt: z.string().nullable(), // ISO date from the ATS, not the aggregator

  remoteType: z.enum(["remote", "hybrid", "onsite", "unclear"]),

  /** True only when the posting (and its structured location fields) say anyone anywhere may apply. */
  worldwide: z.boolean(),
  /** ISO alpha-2 codes from a structured location list. When present, this list decides. */
  eligibleCountries: z.array(z.string().length(2)).default([]),
  eligibleRegions: z.array(Region).default([]),
  /** Countries where the candidate must hold work authorisation or residency. */
  requiresWorkAuthorization: z.array(z.string().length(2)).default([]),
  /** Allowed UTC offsets for the worker's location, if the posting restricts them. */
  tzRestriction: z
    .object({ minUtcOffset: z.number(), maxUtcOffset: z.number() })
    .nullable()
    .default(null),
  /** The posting's exact words about location, kept for the summary and for audits. */
  locationQuote: z.string().default(""),

  companyHq: z.enum(["europe", "north_america", "other", "unknown"]),

  roleFamily: z.enum([
    "ai_engineer",
    "forward_deployed",
    "backend",
    "fullstack",
    "platform_devops",
    "integration",
    "test_automation",
    "data_ml",
    "research",
    "sales",
    "data_labelling",
    "other",
  ]),
  seniority: z.enum(["junior", "mid", "senior", "staff_plus", "unknown"]),
  maxYearsRequired: z.number().nullable(),

  /** Annotation, RLHF rating, "AI trainer" and similar gig work. */
  isTrainingWork: z.boolean().default(false),
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

export const JobStatus = z.enum(["new", "enriched", "verified", "closed", "failed"]);
