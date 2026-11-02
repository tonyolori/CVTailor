import { z } from "zod";

/**
 * The resume as structured JSON. The model writes it once; the user edits it in the
 * dashboard; one template renders it to PDF everywhere (email, download, preview).
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
  skills: z.array(z.object({ group: z.string(), items: z.array(z.string()).min(1) })),
  experience: z.array(
    z.object({
      title: z.string(),
      company: z.string(),
      start: z.string(),
      end: z.string().nullable(), // null = present
      bullets: z.array(z.string().min(1)),
    }),
  ),
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
  education: z.array(
    z.object({
      degree: z.string(),
      school: z.string(),
      location: z.string().optional(),
      start: z.string(),
      end: z.string(),
    }),
  ),
});

export type Resume = z.infer<typeof ResumeSchema>;

export const ResumeSource = z.enum(["ai", "user"]);
