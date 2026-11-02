import { z } from "zod";

/** One verifiable statement. Resume bullets may only be built from these. */
export const FactSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  /**
   * True when the number describes what an architecture was built to handle,
   * not a measured result. The verifier rejects "processed/served" phrasing for these.
   */
  designCapacity: z.boolean().default(false),
});

/** A role, project or education entry in the user's fact library (the old lib/ files). */
export const FactEntrySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["role", "project", "education"]),
  title: z.string().min(1),
  org: z.string().min(1),
  start: z.string().optional(), // "2024-03"
  end: z.string().nullable().optional(), // null or missing = current
  location: z.string().optional(),
  url: z.string().url().optional(),

  facts: z.array(FactSchema).min(1),
  /** Pre-written bullet wordings to start from. */
  variants: z.array(z.string()).default([]),
  /** Things the user must never be described as having done. Substring-matched by the verifier. */
  doNotClaim: z.array(z.string()).default([]),
  /** Free-text notes shown to the generator, e.g. "internal tooling, not a customer feature". */
  notes: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
});

export const FactLibrarySchema = z.object({
  contact: z.object({
    name: z.string(),
    location: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().email(),
    links: z.array(z.object({ label: z.string(), url: z.string().url() })).default([]),
  }),
  entries: z.array(FactEntrySchema),
  /** Extra skills the user confirms they have, beyond entry tags. */
  skills: z.array(z.string()).default([]),
});

export type Fact = z.infer<typeof FactSchema>;
export type FactEntry = z.infer<typeof FactEntrySchema>;
export type FactLibrary = z.infer<typeof FactLibrarySchema>;
