import { z } from "zod";

/** One verifiable statement. Resume bullets may only be built from these. */
export const FactSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  /**
   * True when the number describes what something was built or sized to handle,
   * not a measured result. The verifier rejects "processed/served" phrasing for these.
   */
  designCapacity: z.boolean().default(false),
});

/** A role, project, education or volunteering entry in the user's fact library. */
export const FactEntrySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["role", "project", "education", "volunteering"]),
  title: z.string().min(1),
  org: z.string().min(1),
  start: z.string().optional(), // "2024-03"
  end: z.string().nullable().optional(), // null or missing = current
  location: z.string().optional(),
  url: z.string().url().optional(),

  facts: z.array(FactSchema).default([]),
  /** Pre-written bullet wordings to start from. */
  variants: z.array(z.string()).default([]),
  /** Things the user must never be described as having done. Substring-matched by the verifier. */
  doNotClaim: z.array(z.string()).default([]),
  /** Free-text notes shown to the generator, e.g. "internal tooling, not a customer feature". */
  notes: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
});

/** A licence, certification or registration. High-stakes in many professions: never inferred. */
export const CredentialSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  issuer: z.string().optional(),
  year: z.string().optional(),
  /** Licence or registration number, only if the user wants it on the CV. */
  reference: z.string().optional(),
});

export const LanguageSchema = z.object({
  name: z.string().min(1),
  level: z.string().optional(),
});

export const PublicationSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  venue: z.string().optional(),
  year: z.string().optional(),
  url: z.string().url().optional(),
});

export const LinkSchema = z.object({ label: z.string(), url: z.string().url() });

export const FactLibrarySchema = z.object({
  contact: z.object({
    name: z.string(),
    location: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().email(),
    links: z.array(LinkSchema).default([]),
  }),
  entries: z.array(FactEntrySchema),
  /** Extra skills the user confirms they have, beyond entry tags. */
  skills: z.array(z.string()).default([]),
  credentials: z.array(CredentialSchema).default([]),
  languages: z.array(LanguageSchema).default([]),
  publications: z.array(PublicationSchema).default([]),
  portfolioLinks: z.array(LinkSchema).default([]),
});

export type Fact = z.infer<typeof FactSchema>;
export type FactEntry = z.infer<typeof FactEntrySchema>;
export type FactLibrary = z.infer<typeof FactLibrarySchema>;
export type FactLibraryInput = z.input<typeof FactLibrarySchema>;
export type Credential = z.infer<typeof CredentialSchema>;

/**
 * Job titles the person has held, latest first, for proposing what to search for. Read straight
 * from the library, so it costs nothing and needs no model. A role with no end date is current.
 */
export function titlesFromLibrary(lib: Pick<FactLibrary, "entries">, max = 4): string[] {
  const roles = lib.entries
    .filter((e) => e.kind === "role")
    .map((e) => ({ title: e.title.trim(), key: `${e.end == null ? "9999-99" : e.end}|${e.start ?? ""}` }))
    .sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of roles) {
    const k = r.title.toLowerCase();
    if (!r.title || seen.has(k)) continue;
    seen.add(k);
    out.push(r.title);
    if (out.length === max) break;
  }
  return out;
}
