import type { FactLibrary } from "./facts";
import type { Resume } from "./resume";

export interface VerifyIssue {
  severity: "error" | "warn";
  path: string;
  message: string;
}

export interface VerifyResult {
  ok: boolean;
  issues: VerifyIssue[];
}

const ALIASES: Record<string, string> = {
  postgres: "postgresql",
  "node.js": "nodejs",
  node: "nodejs",
  "c#": "csharp",
  ".net": "dotnet",
  "asp.net": "aspnet",
  js: "javascript",
  ts: "typescript",
  k8s: "kubernetes",
};

function norm(s: string): string {
  const t = s.trim().toLowerCase();
  return ALIASES[t] ?? t.replace(/\s+/g, " ");
}

/** Numeric values in text, with k/m suffixes expanded so "70k" equals "70,000". */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  // Skips digits glued to letters or "#" (OAuth2, C#12) so language versions don't read as metrics.
  const re = /(?<![A-Za-z0-9.#])(\d[\d,]*(?:\.\d+)?)\s?(k|m|million|thousand)?(?![A-Za-z0-9])/gi;
  for (const m of text.matchAll(re)) {
    let n = parseFloat((m[1] ?? "").replace(/,/g, ""));
    if (Number.isNaN(n)) continue;
    const suffix = m[2]?.toLowerCase();
    if (suffix === "k" || suffix === "thousand") n *= 1_000;
    if (suffix === "m" || suffix === "million") n *= 1_000_000;
    out.push(n);
  }
  return out;
}

const MEASURED_VERBS = /\b(process(?:ed|es|ing)?|serv(?:ed|es|ing)|handl(?:ed|es|ing)|support(?:ed|s|ing))\b/i;

interface TextSlot {
  path: string;
  text: string;
}

function resumeTextSlots(r: Resume): TextSlot[] {
  const slots: TextSlot[] = [{ path: "summary", text: r.summary }];
  r.experience.forEach((x, i) =>
    x.bullets.forEach((b, j) => slots.push({ path: `experience[${i}].bullets[${j}]`, text: b })),
  );
  r.projects.forEach((x, i) =>
    x.bullets.forEach((b, j) => slots.push({ path: `projects[${i}].bullets[${j}]`, text: b })),
  );
  return slots;
}

/**
 * Checks an AI-written resume against the user's own fact library.
 * Run it on the AI draft only. User edits get a softer warning in the editor.
 *
 * Rules, all deterministic:
 *  1. Every number in the summary or a bullet must appear in the library.
 *  2. Every skill must be a library tag, a confirmed skill, or appear in a fact.
 *  3. No phrase from any entry's doNotClaim list may appear.
 *  4. A design-capacity number may not be phrased as processed/served/handled.
 *  5. Every experience entry must match a library entry by company.
 */
export function verifyResume(resume: Resume, lib: FactLibrary): VerifyResult {
  const issues: VerifyIssue[] = [];

  const corpusParts: string[] = [];
  const knownNumbers = new Set<number>();
  const designCapacityNumbers = new Set<number>();
  const terms = new Set<string>();
  const orgs = new Set<string>();

  for (const entry of lib.entries) {
    orgs.add(entry.org.trim().toLowerCase());
    corpusParts.push(entry.title, entry.org, ...entry.variants);
    for (const s of [entry.start, entry.end]) if (s) numbersIn(s).forEach((n) => knownNumbers.add(n));
    entry.tags.forEach((t) => terms.add(norm(t)));
    for (const f of entry.facts) {
      corpusParts.push(f.text);
      const nums = numbersIn(f.text);
      nums.forEach((n) => knownNumbers.add(n));
      if (f.designCapacity) nums.forEach((n) => designCapacityNumbers.add(n));
    }
    for (const v of entry.variants) numbersIn(v).forEach((n) => knownNumbers.add(n));
  }
  lib.skills.forEach((s) => terms.add(norm(s)));
  const corpus = corpusParts.join("\n").toLowerCase();

  const slots = resumeTextSlots(resume);

  for (const { path, text } of slots) {
    const lower = text.toLowerCase();

    for (const n of numbersIn(text)) {
      if (!knownNumbers.has(n)) {
        issues.push({
          severity: "error",
          path,
          message: `Number ${n.toLocaleString("en-US")} is not in your fact library.`,
        });
      }
    }

    for (const entry of lib.entries) {
      for (const phrase of entry.doNotClaim) {
        if (phrase.trim() && lower.includes(phrase.trim().toLowerCase())) {
          issues.push({
            severity: "error",
            path,
            message: `Contains a phrase you marked as not claimable: "${phrase}".`,
          });
        }
      }
    }

    if (MEASURED_VERBS.test(text) && numbersIn(text).some((n) => designCapacityNumbers.has(n))) {
      issues.push({
        severity: "error",
        path,
        message: 'A "built for" capacity figure is phrased as a measured result. Use "built for" or "designed to".',
      });
    }
  }

  resume.skills.forEach((group, gi) =>
    group.items.forEach((item, ii) => {
      const n = norm(item);
      if (!terms.has(n) && !corpus.includes(item.trim().toLowerCase())) {
        issues.push({
          severity: "error",
          path: `skills[${gi}].items[${ii}]`,
          message: `Skill "${item}" does not appear in your fact library.`,
        });
      }
    }),
  );

  resume.experience.forEach((x, i) => {
    if (!orgs.has(x.company.trim().toLowerCase())) {
      issues.push({
        severity: "warn",
        path: `experience[${i}].company`,
        message: `Company "${x.company}" does not match any library entry.`,
      });
    }
  });

  return { ok: issues.every((i) => i.severity !== "error"), issues };
}
