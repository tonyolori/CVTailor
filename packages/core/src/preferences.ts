import { z } from "zod";

export const Region = z.enum([
  "EU",
  "UK",
  "EMEA",
  "AFRICA",
  "NORTH_AMERICA",
  "LATAM",
  "APAC",
  "MENA",
]);
export type Region = z.infer<typeof Region>;

/**
 * Per-user search preferences. This replaces preferences.md.
 * Produced by the onboarding form; stored as JSON in `preferences.data`.
 */
export const PreferencesSchema = z.object({
  targetTitles: z.array(z.string().min(1)).min(1),
  /** Tiered fallback titles, searched only when the first pass finds fewer than minPicks. */
  expansionTitles: z
    .object({
      a: z.array(z.string()).default([]),
      b: z.array(z.string()).default([]),
      c: z.array(z.string()).default([]),
    })
    .default({ a: [], b: [], c: [] }),

  eligibility: z.object({
    /** ISO 3166-1 alpha-2, e.g. "NG". */
    country: z.string().length(2),
    /** Regions the user's country falls in, e.g. ["AFRICA", "EMEA"]. Set at onboarding. */
    regions: z.array(Region).default([]),
    /** The user's UTC offset in hours, e.g. 1 for Lagos. */
    utcOffsetHours: z.number().min(-12).max(14),
  }),

  /** Where the hiring company must be based. "any" disables the gate. */
  companyBase: z.array(z.enum(["europe", "north_america", "any"])).min(1).default(["any"]),

  excludeTitleKeywords: z
    .array(z.string())
    .default(["staff", "principal", "lead", "head of", "director", "manager"]),
  maxYearsRequired: z.number().int().min(0).max(30).default(5),
  maxPostingAgeDays: z.number().int().min(1).max(60).default(14),

  minScore: z.number().min(0).max(10).default(7),
  minPicks: z.number().int().min(0).max(10).default(3),
  dailyCap: z.number().int().min(1).max(10).default(10),

  worthALookCount: z.number().int().min(0).max(10).default(3),
  worthALookMinScore: z.number().min(0).max(10).default(8),
});

export type Preferences = z.infer<typeof PreferencesSchema>;
export type PreferencesInput = z.input<typeof PreferencesSchema>;
