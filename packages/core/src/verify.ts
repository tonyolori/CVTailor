import type { FactLibrary } from "./facts";
import type { CoverLetter, Resume } from "./resume";

export interface VerifyIssue {
  severity: "error" | "warn";
  path: string;
  message: string;
}

export interface VerifyResult {
  ok: boolean;
  issues: VerifyIssue[];
}

/** Spellings that mean the same term, so the posting's spelling can stand in for the library's. */
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
  ifrs: "international financial reporting standards",
  gaap: "generally accepted accounting principles",
  ms: "microsoft",
  "ms excel": "excel",
  "microsoft excel": "excel",
  iv: "intravenous",
};

function norm(s: string): string {
  const t = s.trim().toLowerCase();
  return ALIASES[t] ?? t.replace(/\s+/g, " ");
}

function normLoose(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Numeric values in text, with k/m suffixes expanded so "70k" equals "70,000". */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  // Skips digits glued to letters or "#" (OAuth2, C#12) so product versions don't read as metrics.
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

/** "Certified X" style claims in running text. The following word must appear after the same keyword in the library. */
const CREDENTIAL_CLAIM =
  /\b(licen[cs]ed|certified|chartered|registered|accredited|board[- ]certified)\s+([\p{L}&.-]+)/giu;

/** Credential abbreviations across professions. Only flagged when absent from the library. */
const CREDENTIAL_ABBREVIATIONS = new Set(
  "ACA ACCA AWS-SAA BCBA CFA CFP CIMA CIPD CIPS CISA CISM CISSP CMA COREN CPA CPHQ CRNA DNP FRCS ICAN JD LLB LLM MBBS MBA MD MRCP NMC PE PGCE PHD PMP QTS RN RPH SHRM".split(
    " ",
  ),
);

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
  r.volunteering.forEach((x, i) =>
    x.bullets.forEach((b, j) => slots.push({ path: `volunteering[${i}].bullets[${j}]`, text: b })),
  );
  return slots;
}

class LibraryIndex {
  knownNumbers = new Set<number>();
  designCapacityNumbers = new Set<number>();
  terms = new Set<string>();
  orgs = new Set<string>();
  corpus: string;
  credentialNames: string[];
  languageNames: Set<string>;
  doNotClaim: string[] = [];

  constructor(readonly lib: FactLibrary) {
    const parts: string[] = [];
    for (const entry of lib.entries) {
      this.orgs.add(normLoose(entry.org));
      parts.push(entry.title, entry.org, ...entry.variants);
      for (const s of [entry.start, entry.end]) if (s) numbersIn(s).forEach((n) => this.knownNumbers.add(n));
      entry.tags.forEach((t) => this.terms.add(norm(t)));
      for (const f of entry.facts) {
        parts.push(f.text);
        const nums = numbersIn(f.text);
        nums.forEach((n) => this.knownNumbers.add(n));
        if (f.designCapacity) nums.forEach((n) => this.designCapacityNumbers.add(n));
      }
      for (const v of entry.variants) numbersIn(v).forEach((n) => this.knownNumbers.add(n));
      this.doNotClaim.push(...entry.doNotClaim.filter((p) => p.trim()));
    }
    lib.skills.forEach((s) => this.terms.add(norm(s)));
    for (const c of lib.credentials) {
      parts.push(c.name, c.issuer ?? "");
      if (c.year) numbersIn(c.year).forEach((n) => this.knownNumbers.add(n));
      numbersIn(c.name).forEach((n) => this.knownNumbers.add(n));
    }
    for (const p of lib.publications) {
      parts.push(p.title, p.venue ?? "");
      if (p.year) numbersIn(p.year).forEach((n) => this.knownNumbers.add(n));
    }
    lib.languages.forEach((l) => parts.push(l.name));
    this.corpus = parts.join("\n").toLowerCase();
    this.credentialNames = lib.credentials.map((c) => normLoose(c.name));
    this.languageNames = new Set(lib.languages.map((l) => normLoose(l.name)));
  }

  hasCredential(name: string): boolean {
    const n = normLoose(name);
    return this.credentialNames.some((c) => c === n);
  }
}

/** Claims of a licence, certification or qualification in running text that the library doesn't support. */
function credentialClaimIssues(path: string, text: string, idx: LibraryIndex): VerifyIssue[] {
  const issues: VerifyIssue[] = [];
  for (const m of text.matchAll(CREDENTIAL_CLAIM)) {
    const phrase = `${m[1]} ${m[2]}`.toLowerCase().replace(/[.,;:]+$/, "");
    if (!idx.corpus.includes(phrase)) {
      issues.push({
        severity: "error",
        path,
        message: `Claims "${m[0]}", which is not in your library. Credentials can't be inferred.`,
      });
    }
  }
  const upperCorpus = idx.corpus.toUpperCase();
  for (const token of text.match(/\b[A-Z][A-Z-]{1,7}\b/g) ?? []) {
    if (CREDENTIAL_ABBREVIATIONS.has(token) && !new RegExp(`\\b${token}\\b`).test(upperCorpus)) {
      issues.push({
        severity: "error",
        path,
        message: `Mentions "${token}", a credential that is not in your library.`,
      });
    }
  }
  return issues;
}

function textSlotIssues(slots: TextSlot[], idx: LibraryIndex): VerifyIssue[] {
  const issues: VerifyIssue[] = [];
  for (const { path, text } of slots) {
    const lower = text.toLowerCase();
    for (const n of numbersIn(text)) {
      if (!idx.knownNumbers.has(n)) {
        issues.push({
          severity: "error",
          path,
          message: `Number ${n.toLocaleString("en-US")} is not in your fact library.`,
        });
      }
    }
    for (const phrase of idx.doNotClaim) {
      if (lower.includes(phrase.trim().toLowerCase())) {
        issues.push({ severity: "error", path, message: `Contains a phrase you marked as not claimable: "${phrase}".` });
      }
    }
    if (MEASURED_VERBS.test(text) && numbersIn(text).some((n) => idx.designCapacityNumbers.has(n))) {
      issues.push({
        severity: "error",
        path,
        message: 'A "built for" capacity figure is phrased as a measured result. Use "built for" or "designed to".',
      });
    }
    issues.push(...credentialClaimIssues(path, text, idx));
  }
  return issues;
}

/**
 * Checks an AI-written resume against the user's own fact library.
 * Run it on the AI draft only. User edits get a softer warning in the editor.
 *
 * Rules, all deterministic:
 *  1. Every number in running text must appear in the library.
 *  2. Every listed skill or term must be a library tag, a confirmed skill, or appear in a fact.
 *  3. No phrase from any entry's doNotClaim list may appear.
 *  4. A design-capacity number may not be phrased as processed/served/handled.
 *  5. Every experience, education and volunteering entry must match a library entry.
 *  6. Every credential, language and publication must be in the library. Credential
 *     claims in running text are checked too.
 */
export function verifyResume(resume: Resume, lib: FactLibrary): VerifyResult {
  const idx = new LibraryIndex(lib);
  const issues = textSlotIssues(resumeTextSlots(resume), idx);

  resume.skills.forEach((group, gi) =>
    group.items.forEach((item, ii) => {
      const n = norm(item);
      if (!idx.terms.has(n) && !idx.corpus.includes(item.trim().toLowerCase()) && !idx.corpus.includes(n)) {
        issues.push({
          severity: "error",
          path: `skills[${gi}].items[${ii}]`,
          message: `"${item}" does not appear in your fact library.`,
        });
      }
    }),
  );

  resume.experience.forEach((x, i) => {
    if (!idx.orgs.has(normLoose(x.company))) {
      issues.push({
        severity: "error",
        path: `experience[${i}].company`,
        message: `Employer "${x.company}" does not match any library entry.`,
      });
      return;
    }
    const entries = lib.entries.filter((e) => normLoose(e.org) === normLoose(x.company) && e.start);
    if (entries.length > 0 && !entries.some((e) => e.start === x.start)) {
      issues.push({
        severity: "warn",
        path: `experience[${i}].start`,
        message: `Start date "${x.start}" differs from the library's dates for ${x.company}.`,
      });
    }
  });

  const education = lib.entries.filter((e) => e.kind === "education");
  resume.education.forEach((x, i) => {
    const match = education.some(
      (e) => normLoose(e.org) === normLoose(x.school) && normLoose(e.title) === normLoose(x.degree),
    );
    if (!match) {
      issues.push({
        severity: "error",
        path: `education[${i}]`,
        message: `"${x.degree}, ${x.school}" does not match any education entry in your library.`,
      });
    }
  });

  resume.credentials.forEach((c, i) => {
    if (!idx.hasCredential(c.name)) {
      issues.push({
        severity: "error",
        path: `credentials[${i}].name`,
        message: `Credential "${c.name}" is not in your library.`,
      });
      return;
    }
    const known = lib.credentials.find((k) => normLoose(k.name) === normLoose(c.name));
    if (c.issuer && known?.issuer && normLoose(c.issuer) !== normLoose(known.issuer)) {
      issues.push({
        severity: "error",
        path: `credentials[${i}].issuer`,
        message: `Issuer "${c.issuer}" differs from your library (${known.issuer}).`,
      });
    }
    if (c.year && c.year !== known?.year) {
      issues.push({
        severity: "error",
        path: `credentials[${i}].year`,
        message: `Year "${c.year}" for "${c.name}" differs from your library.`,
      });
    }
  });

  resume.languages.forEach((l, i) => {
    if (!idx.languageNames.has(normLoose(l.name))) {
      issues.push({ severity: "error", path: `languages[${i}]`, message: `Language "${l.name}" is not in your library.` });
    }
  });

  resume.publications.forEach((p, i) => {
    if (!lib.publications.some((k) => normLoose(k.title) === normLoose(p.title))) {
      issues.push({
        severity: "error",
        path: `publications[${i}]`,
        message: `Publication "${p.title}" is not in your library.`,
      });
    }
  });

  resume.volunteering.forEach((v, i) => {
    if (!idx.orgs.has(normLoose(v.org))) {
      issues.push({
        severity: "error",
        path: `volunteering[${i}].org`,
        message: `Volunteering with "${v.org}" does not match any library entry.`,
      });
    }
  });

  const knownUrls = new Set(
    [
      ...lib.contact.links.map((l) => l.url),
      ...lib.portfolioLinks.map((l) => l.url),
      ...lib.entries.flatMap((e) => (e.url ? [e.url] : [])),
    ].map(normUrl),
  );
  resume.portfolioLinks.forEach((l, i) => {
    if (!knownUrls.has(normUrl(l.url))) {
      issues.push({ severity: "error", path: `portfolioLinks[${i}]`, message: `Link ${l.url} is not in your library.` });
    }
  });

  return { ok: issues.every((i) => i.severity !== "error"), issues };
}

function normUrl(u: string): string {
  return u.trim().toLowerCase().replace(/\/+$/, "");
}

/** Same deterministic checks for a cover letter's running text. */
export function verifyCoverLetter(letter: CoverLetter, lib: FactLibrary): VerifyResult {
  const idx = new LibraryIndex(lib);
  const slots = letter.paragraphs.map((text, i) => ({ path: `paragraphs[${i}]`, text }));
  const issues = textSlotIssues(slots, idx);
  return { ok: issues.every((i) => i.severity !== "error"), issues };
}
