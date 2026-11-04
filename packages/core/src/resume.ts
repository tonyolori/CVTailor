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

/** How a CV looks. Chosen per user in settings, and optionally per CV in the editor. */
export const CvStyle = z.enum(["fitted", "classic", "plain", "compact"]);
export type CvStyle = z.infer<typeof CvStyle>;
export const DEFAULT_CV_STYLE: CvStyle = "fitted";

export const CV_STYLES: { id: CvStyle; label: string; description: string }[] = [
  { id: "fitted", label: "Fitted", description: "A serif design with a blue headline." },
  { id: "classic", label: "Classic", description: "A centred name with navy headings." },
  { id: "plain", label: "Plain", description: "Black and white with one simple font. A safe choice for formal applications." },
  { id: "compact", label: "Compact", description: "Smaller text and tighter spacing, for fitting more on the page." },
];

/** Reads a stored style, falling back to the default for anything unrecognised. */
export function cvStyleOf(value: unknown): CvStyle {
  const parsed = CvStyle.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_CV_STYLE;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const m = value.match(/^(\d{4})-(\d{2})/);
  if (m) return `${MONTHS[Number(m[2]) - 1] ?? ""} ${m[1]}`.trim();
  return value;
}

export function dateRange(start: string | null | undefined, end: string | null | undefined, open = true): string {
  const from = formatDate(start);
  const to = end ? formatDate(end) : open ? "Present" : "";
  return from && to ? `${from} – ${to}` : from || to;
}

/** Sections in the chosen order. A section with content that's missing from the order still appears at the end. */
export function orderedSections(r: Resume): ResumeSection[] {
  const all: ResumeSection[] = ["summary", "skills", "credentials", "experience", "projects", "education", "languages", "publications", "volunteering", "portfolio"];
  return [...new Set([...r.sectionOrder, ...all])];
}

/** Section headings, shared by the PDF templates and the on-screen CV. */
export const SECTION_TITLES: Record<ResumeSection, string> = {
  summary: "Summary",
  skills: "Skills",
  credentials: "Licences and certifications",
  experience: "Experience",
  projects: "Projects",
  education: "Education",
  languages: "Languages",
  publications: "Publications",
  volunteering: "Volunteering",
  portfolio: "Portfolio",
};

/** Paid plan, an unexpired plan, or billing not switched on yet. Web and worker both decide with this. */
export function isEntitled(user: { plan: string; paidUntil: string | null }, billingEnforced: boolean, now: Date): boolean {
  if (!billingEnforced) return true;
  return user.plan === "pro" && user.paidUntil != null && new Date(user.paidUntil).getTime() > now.getTime();
}

/** CVs one person can ask for per UTC day, unless CV_REQUESTS_PER_DAY says otherwise. Each one costs money to write. */
export const DEFAULT_CV_REQUESTS_PER_DAY = 5;

/** Shortest and longest pasted posting. Longer text is what the model is given anyway. */
export const MIN_POSTING_CHARS = 80;
export const MAX_POSTING_CHARS = 20_000;
