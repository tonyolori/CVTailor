import type { FactEntry } from "@jobtailor/core";

/**
 * One-off converter for the legacy markdown fact library. Deterministic, so nothing can
 * be invented on the way through. Output is reviewed by the library's owner before use.
 *
 * Format: "## Title, Org" starts a role, followed by a date line and an optional
 * "Stack:" line. "### Topic `#tag`" starts a topic inside it. "**Facts**", "**Variants**"
 * and "**Notes**" (optionally prefixed, e.g. "**Portfolio facts**") head bullet lists.
 */
const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

export function parseMonth(s: string): string | null {
  const m = s.trim().match(/^([A-Za-z]{3})[a-z]*\s+(\d{4})$/);
  const month = m && MONTHS[m[1]!.toLowerCase()];
  return m && month ? `${m[2]}-${month}` : null;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

const clean = (s: string) => s.replace(/\*\*/g, "").replace(/`/g, "").trim();

interface Section {
  kind: "facts" | "variants" | "notes" | "other";
  bullets: string[];
}

function parseSections(lines: string[]): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;
  let parent: string | null = null;
  for (const line of lines) {
    const head = line.match(/^\*\*(.+?)\*\*\s*$/);
    if (head) {
      const h = head[1]!.toLowerCase();
      const kind = /\bfacts\b/.test(h) ? "facts" : /\bvariants\b/.test(h) ? "variants" : /\bnotes\b/.test(h) ? "notes" : "other";
      current = { kind, bullets: [] };
      sections.push(current);
      parent = null;
      continue;
    }
    if (!current) continue;
    const nested = line.match(/^\s{2,}- (.+)$/);
    if (nested && parent) {
      current.bullets.push(`${parent.replace(/:$/, "")}: ${clean(nested[1]!)}`);
      continue;
    }
    const bullet = line.match(/^- (.+)$/);
    if (bullet) {
      parent = clean(bullet[1]!);
      current.bullets.push(parent);
    }
  }
  return sections;
}

interface Scope {
  title: string;
  org: string;
  kind: FactEntry["kind"];
  start?: string;
  end?: string | null;
  url?: string;
  id: string;
}

function makeEntry(scope: Scope, topic: string | null, tags: string[], lines: string[], extraTags: string[]): FactEntry | null {
  const sections = parseSections(lines);
  const of = (kind: Section["kind"]) => sections.filter((s) => s.kind === kind).flatMap((s) => s.bullets);
  const entryId = topic ? `${scope.id}-${slug(topic)}` : scope.id;
  const facts = of("facts").map((text, i) => {
    const designCapacity = /_\(design capacity\)_/.test(text);
    return { id: `${entryId}-f${i + 1}`, text: text.replace(/_\(design capacity\)_\s*/g, "").trim(), designCapacity };
  });
  const variants = of("variants");
  const notes = of("notes");
  if (facts.length === 0 && variants.length === 0 && notes.length === 0) return null;
  return {
    id: entryId,
    kind: scope.kind,
    title: scope.title,
    org: scope.org,
    ...(scope.start ? { start: scope.start } : {}),
    ...(scope.end !== undefined ? { end: scope.end } : {}),
    ...(scope.url ? { url: scope.url } : {}),
    facts,
    variants,
    doNotClaim: notes.flatMap((n) => [...n.matchAll(/[Nn]ever write "([^"]+)"/g)].map((m) => m[1]!)),
    notes: topic ? [`Topic: ${topic}`, ...notes] : notes,
    tags: [...new Set([...tags, ...extraTags])],
  };
}

function parseTopics(scope: Scope, body: string[], stack: string[]): FactEntry[] {
  const out: FactEntry[] = [];
  const preamble: string[] = [];
  let topic: { name: string; tags: string[]; lines: string[] } | null = null;
  const flush = () => {
    if (!topic) return;
    const e = makeEntry(scope, topic.name, topic.tags, topic.lines, []);
    if (e) out.push(e);
    topic = null;
  };
  for (const line of body) {
    const h3 = line.match(/^### (.+)$/);
    if (h3) {
      flush();
      const tags = [...h3[1]!.matchAll(/`#([^`]+)`/g)].map((m) => m[1]!);
      topic = { name: clean(h3[1]!.replace(/`#[^`]+`/g, "")), tags, lines: [] };
    } else if (topic) {
      topic.lines.push(line);
    } else {
      preamble.push(line);
    }
  }
  flush();
  const role = makeEntry(scope, null, [], preamble, stack);
  if (role) return [role, ...out];
  // A role with no role-level facts still carries its stack, on the first topic.
  if (out[0]) out[0].tags = [...new Set([...out[0].tags, ...stack])];
  return out;
}

const STACK = /^Stack:\s*(.+)$/;

function parseStack(lines: string[]): string[] {
  const line = lines.map((l) => l.match(STACK)).find(Boolean);
  if (!line) return [];
  return line[1]!
    .split(" / ")
    .map((s) => s.replace(/\(.*?\)/g, "").trim())
    .filter(Boolean);
}

export interface ParsedLibrary {
  entries: FactEntry[];
  skills: string[];
}

export function parseWorkExperiences(md: string): ParsedLibrary {
  const entries: FactEntry[] = [];
  const skills: string[] = [];
  const blocks = md.split(/^## /m).slice(1);
  for (const block of blocks) {
    const lines = block.split("\n");
    const heading = lines[0]!.trim();
    const body = lines.slice(1);
    if (/^skills not tied/i.test(heading)) {
      for (const l of body) {
        const m = l.match(/^- (.+)$/);
        if (!m) continue;
        const beforeNote = m[1]!.split(":")[0]!.replace(/\(.*?\)/g, "");
        skills.push(...beforeNote.split(",").map((s) => s.trim()).filter(Boolean));
      }
      continue;
    }
    const comma = heading.indexOf(",");
    const title = heading.slice(0, comma).trim();
    const org = heading.slice(comma + 1).replace(/\(client:.*?\)/, "").trim();
    const dates = body.map((l) => l.match(/^([A-Z][a-z]{2} \d{4})\s+[–-]\s+(.+)$/)).find(Boolean);
    const scope: Scope = {
      title,
      org,
      kind: "role",
      id: slug(org),
      start: dates ? (parseMonth(dates[1]!) ?? undefined) : undefined,
      end: dates ? (/present/i.test(dates[2]!) ? null : (parseMonth(dates[2]!) ?? undefined)) : undefined,
    };
    entries.push(...parseTopics(scope, body, parseStack(body)));
    skills.push(...parseStack(body));
  }
  return { entries, skills: [...new Set(skills)] };
}

export function parseProject(md: string): ParsedLibrary {
  const lines = md.split("\n");
  const name = lines[0]!.replace(/^#\s*/, "").trim();
  const url = lines.find((l) => /^https?:\/\//.test(l.trim()))?.trim();
  const scope: Scope = { title: name, org: name, kind: "project", id: `project-${slug(name)}`, url };
  const stack = parseStack(lines);
  return { entries: parseTopics(scope, lines.slice(1), stack), skills: stack };
}
