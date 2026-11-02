import { z } from "zod";
import { CvConvention, PageSize } from "./preferences";

export const ResumeSection = z.enum([
  "summary",
  "skills",
  "credentials",
  "experience",
  "projects",
  "education",
  "languages",
  "publications",
  "volunteering",
  "portfolio",
]);
export type ResumeSection = z.infer<typeof ResumeSection>;

export const DEFAULT_SECTION_ORDER: ResumeSection[] = [
  "summary",
  "skills",
  "experience",
  "projects",
  "education",
  "credentials",
  "languages",
  "publications",
  "volunteering",
  "portfolio",
];

/**
 * The resume as structured JSON. The model writes it once; the user edits it in the
 * dashboard; one template renders it to PDF everywhere (email, download, preview).
 * Personal fields such as a photo or date of birth exist only if a user adds them to
 * their own library; there are deliberately no such fields here.
 */
export const ResumeSchema = z.object({
  header: z.object({
    name: z.string(),
    roleTitle: z.string(),
    location: z.string().optional(),
    phone: z.string().optional(),
    email: z.string(),
    links: z.array(z.object({ label: z.string(), url: z.string() })).default([]),
  }),
  /** Advice shown in the editor only. Never rendered into the PDF. */
  summarySuggestion: z
    .object({
      identity: z.string(),
      hook: z.string(),
      fit: z.string(),
      keywords: z.array(z.string()).default([]),
      leaveOut: z.array(z.string()).default([]),
    })
    .optional(),
  summary: z.string(),
  /** Grouped skills or areas of competence, in the posting's own spelling. */
  skills: z.array(z.object({ group: z.string(), items: z.array(z.string()).min(1) })).default([]),
  experience: z
    .array(
      z.object({
        title: z.string(),
        company: z.string(),
        location: z.string().optional(),
        start: z.string(),
        end: z.string().nullable().default(null), // null = present
        bullets: z.array(z.string().min(1)),
      }),
    )
    .default([]),
  projects: z
    .array(
      z.object({
        name: z.string(),
        url: z.string().optional(),
        stack: z.string().optional(),
        bullets: z.array(z.string().min(1)),
      }),
    )
    .default([]),
  education: z
    .array(
      z.object({
        degree: z.string(),
        school: z.string(),
        location: z.string().optional(),
        start: z.string().optional(),
        end: z.string().optional(),
      }),
    )
    .default([]),
  credentials: z
    .array(
      z.object({
        name: z.string(),
        issuer: z.string().optional(),
        year: z.string().optional(),
        reference: z.string().optional(),
      }),
    )
    .default([]),
  languages: z.array(z.object({ name: z.string(), level: z.string().optional() })).default([]),
  publications: z
    .array(
      z.object({
        title: z.string(),
        venue: z.string().optional(),
        year: z.string().optional(),
        url: z.string().optional(),
      }),
    )
    .default([]),
  volunteering: z
    .array(
      z.object({
        title: z.string(),
        org: z.string(),
        start: z.string().optional(),
        end: z.string().nullable().default(null),
        bullets: z.array(z.string().min(1)).default([]),
      }),
    )
    .default([]),
  portfolioLinks: z.array(z.object({ label: z.string(), url: z.string() })).default([]),

  sectionOrder: z.array(ResumeSection).default(DEFAULT_SECTION_ORDER),
  template: z
    .object({
      convention: CvConvention.default("standard"),
      pageSize: PageSize.default("A4"),
    })
    .default({ convention: "standard", pageSize: "A4" }),
});

export type Resume = z.infer<typeof ResumeSchema>;
export type ResumeInput = z.input<typeof ResumeSchema>;

/** A cover letter as structured text, rendered with the same header as the resume. */
export const CoverLetterSchema = z.object({
  header: ResumeSchema.shape.header,
  date: z.string(),
  subject: z.string(),
  salutation: z.string(),
  paragraphs: z.array(z.string().min(1)).min(2),
  signOff: z.string(),
  signature: z.string(),
  template: ResumeSchema.shape.template,
});
export type CoverLetter = z.infer<typeof CoverLetterSchema>;

export const ResumeSource = z.enum(["ai", "user"]);
