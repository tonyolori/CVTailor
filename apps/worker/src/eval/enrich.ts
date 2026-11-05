import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  EnrichedJobSchema,
  evaluateGates,
  onsiteNursePersona,
  PreferencesSchema,
  remoteAccountantPersona,
  type Category,
  type EnrichedJob,
  type Gate,
  type Persona,
  type Preferences,
} from "@cvtailor/core";
import { createProvider, type LlmProvider } from "@cvtailor/llm";
import { loadConfig, llmConfig } from "../config";
import { buildEnrichRequest, reconcile, type JobRow } from "@cvtailor/ai/enrich";
import { checkLive, resolveAtsRecord, type LiveCheck } from "../pipeline/live";
import { ATS_HOST_POLICIES } from "../sources/ats";
import { politeHttp } from "../sources/http";
import { accountantPostings, nursePostings, type LabelledPosting } from "./persona-postings";

/**
 * npm run eval:enrich [-- --limit N --only owner|accountant|nurse]
 *
 * The owner set needs private/seen.tsv (past decisions) and private/owner.json, and is skipped without them.
 *
 * Runs enrichment plus evaluateGates against known answers and reports agreement by gate.
 * Replies are cached under .local/eval, so re-running costs nothing unless the prompt changes.
 * Roughly 30% of each set is held out (by hash, so it's stable) and must not be used for tuning.
 */
const ROOT = join(import.meta.dirname, "../../../..");
const OUT = join(ROOT, ".local/eval");
const CACHE = join(OUT, "cache");
mkdirSync(CACHE, { recursive: true });

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const LIMIT = Number(flag("limit") ?? 1e9);
const ONLY = flag("only");

const CATEGORIES: Category[] = [
  "other",
  "software-engineering",
  "data-ai",
  "accounting-finance",
  "nursing-healthcare",
  "teaching-education",
  "marketing-communications",
  "sales-customer",
  "design-creative",
  "operations-admin",
  "hr-people",
  "legal-compliance",
  "engineering-trades",
].map((id) => ({ id, keywords: [] }));
const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));

function holdout(id: string): boolean {
  return createHash("sha1").update(id).digest()[0]! % 10 < 3;
}

interface Outcome {
  set: string;
  id: string;
  title: string;
  company: string;
  holdout: boolean;
  expected: string;
  actual: string;
  agree: boolean;
  expectedGates: string[];
  actualGates: string[];
  reasons: string[];
  note?: string;
  costUsd: number;
}

async function enrichCached(provider: LlmProvider, job: JobRow, live: LiveCheck | null): Promise<{ data: EnrichedJob | null; cost: number; error?: string }> {
  const req = buildEnrichRequest(job, live, CATEGORIES);
  const key = createHash("sha1").update(req.system).update(req.user).digest("hex");
  const file = join(CACHE, `${key}.json`);
  if (existsSync(file)) return { data: EnrichedJobSchema.parse(JSON.parse(readFileSync(file, "utf8"))), cost: 0 };
  const r = await provider.complete(req);
  if (!r.ok) return { data: null, cost: r.usage.costUsd, error: `${r.kind}: ${r.error}` };
  writeFileSync(file, JSON.stringify(r.data));
  return { data: r.data, cost: r.usage.costUsd };
}

function credentialsOf(persona: Persona): string[] {
  return [...persona.facts.credentials.map((c) => c.name), ...persona.facts.entries.filter((e) => e.kind === "education").map((e) => e.title)];
}

async function runPersona(provider: LlmProvider, name: string, persona: Persona, postings: LabelledPosting[], now: Date): Promise<Outcome[]> {
  const out: Outcome[] = [];
  for (const p of postings.slice(0, LIMIT)) {
    const job: JobRow = {
      id: 0,
      url: `https://eval.example/${p.id}`,
      apply_url: null,
      company: p.company,
      title: p.title,
      source: "eval",
      posted_at: p.postedAt ?? null,
      ats_posted_at: p.postedAt ?? null,
      from_ats: true,
      raw_text: p.text,
      location_text: p.locationText,
      ats_fields: p.fields ?? {},
      last_verified: null,
    };
    const r = await enrichCached(provider, job, null);
    const base = { set: name, id: p.id, title: p.title, company: p.company, holdout: holdout(p.id), note: p.note, costUsd: r.cost };
    if (!r.data) {
      out.push({ ...base, expected: p.expectFailed.join(",") || "pass", actual: `error (${r.error})`, agree: false, expectedGates: p.expectFailed, actualGates: [], reasons: [] });
      continue;
    }
    const e = reconcile(r.data, job, null, CATEGORY_IDS);
    const g = evaluateGates({ title: p.title, enriched: e }, persona.preferences, now, { credentials: credentialsOf(persona) });
    const same = g.failed.length === p.expectFailed.length && g.failed.every((f) => p.expectFailed.includes(f));
    out.push({
      ...base,
      expected: p.expectFailed.join(",") || "pass",
      actual: g.failed.join(",") || "pass",
      agree: same,
      expectedGates: p.expectFailed,
      actualGates: g.failed,
      reasons: g.reasons,
    });
    process.stdout.write(same ? "." : "x");
  }
  process.stdout.write("\n");
  return out;
}

/** What a past "skipped" reason says failed. Unrecognised reasons compare on pass or fail only. */
function gateFromReason(reason: string): Gate | null {
  const r = reason.toLowerCase();
  if (/\b(closed|expired|no longer|404|not found)\b/.test(r)) return "closed";
  if (/hybrid|on-?site|in[- ]office/.test(r)) return "work_mode";
  if (/\b(sales|research|training|annotation|trainer|gig|rlhf|labell?ing)\b/.test(r)) return "role_type";
  if (/commission|unpaid|fee\b|equity/.test(r)) return "exclusion";
  if (/\byrs?\b|years|staff|principal|lead\b|head of|director|manager|senior/.test(r)) return "seniority";
  if (/time.?zone|utc|pacific|\best\b|hours/.test(r)) return "timezone";
  if (/old\b|days?\b|posted|date|april|may\b|repost/.test(r)) return "age";
  if (/based in|company in|hq\b/.test(r)) return "employer_base";
  if (/only|eligib|location|country|countries|exclude|nigeria|europe|\beu\b|\buk\b|\bus\b|canada|latam|emea|residen|authori[sz]/.test(r)) return "location";
  return null;
}

async function runOwner(provider: LlmProvider): Promise<Outcome[]> {
  const seenPath = join(ROOT, "private/seen.tsv");
  const seedPath = join(ROOT, "private/owner.json");
  if (!existsSync(seenPath) || !existsSync(seedPath)) {
    console.log("private/seen.tsv or private/owner.json not found: skipping the owner set");
    return [];
  }
  const prefs: Preferences = PreferencesSchema.parse(JSON.parse(readFileSync(seedPath, "utf8")).preferences);
  const rows = readFileSync(seenPath, "utf8").trim().split("\n").slice(1).map((l) => l.split("\t"));
  const http = politeHttp(ATS_HOST_POLICIES);
  const out: Outcome[] = [];
  let unfetchable = 0;
  for (const [date, url, company, title, decision, reason] of rows.slice(0, LIMIT)) {
    if (!url || !decision) continue;
    const record = await resolveAtsRecord(http, url);
    const live = record ? null : await checkLive(http, url);
    if (!record && (!live?.reachable || !live.text || live.text.length < 200)) {
      unfetchable++;
      process.stdout.write("-");
      continue;
    }
    const job: JobRow = {
      id: 0,
      url,
      apply_url: url,
      company: company ?? "",
      title: title ?? "",
      source: record?.source ?? "page",
      posted_at: record?.postedAt ?? null,
      ats_posted_at: record?.postedAt ?? null,
      from_ats: Boolean(record),
      raw_text: record?.description ?? live?.text ?? "",
      location_text: record?.locationText ?? "",
      ats_fields: record?.atsFields ?? {},
      last_verified: null,
    };
    const r = await enrichCached(provider, job, live);
    const expectedGate = gateFromReason(reason ?? "");
    const expected = decision === "worth-a-look" ? "near-miss" : decision === "skipped" ? "fail" : "pass";
    const base = { set: "owner", id: url, title: title ?? "", company: company ?? "", holdout: holdout(url), costUsd: r.cost, note: `${decision}: ${reason}` };
    if (!r.data) {
      out.push({ ...base, expected, actual: `error (${r.error})`, agree: false, expectedGates: expectedGate ? [expectedGate] : [], actualGates: [], reasons: [] });
      continue;
    }
    const e = reconcile(r.data, job, live, CATEGORY_IDS);
    // Judge on the day the decision was made. Postings have aged since, and may have since closed.
    const g = evaluateGates({ title: title ?? "", enriched: { ...e, isOpen: true } }, prefs, new Date(`${date}T12:00:00Z`));
    const actual = g.pass ? "pass" : g.nearMiss ? "near-miss" : "fail";
    const agree = expected === "fail" ? actual !== "pass" : actual === expected;
    out.push({
      ...base,
      expected,
      actual,
      agree,
      expectedGates: expectedGate ? [expectedGate] : [],
      actualGates: g.failed,
      reasons: g.reasons,
    });
    process.stdout.write(agree ? "." : "x");
  }
  process.stdout.write(`\nowner: ${unfetchable} postings no longer fetchable\n`);
  return out;
}

function summarise(outcomes: Outcome[]) {
  const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(0)}% (${n}/${d})`);
  const sets = [...new Set(outcomes.map((o) => o.set))];
  const lines: string[] = [];
  for (const set of sets) {
    const rows = outcomes.filter((o) => o.set === set);
    const tune = rows.filter((o) => !o.holdout);
    const hold = rows.filter((o) => o.holdout);
    lines.push(`\n## ${set}`);
    lines.push(`Agreement: tuning set ${pct(tune.filter((o) => o.agree).length, tune.length)}, held out ${pct(hold.filter((o) => o.agree).length, hold.length)}`);
    const gates = [...new Set(rows.flatMap((o) => [...o.expectedGates, ...o.actualGates]))].sort();
    for (const gate of gates) {
      const expected = rows.filter((o) => o.expectedGates.includes(gate));
      const hit = expected.filter((o) => o.actualGates.includes(gate));
      const falsePos = rows.filter((o) => o.actualGates.includes(gate) && !o.expectedGates.includes(gate) && o.expected === "pass");
      lines.push(`  ${gate.padEnd(14)} caught ${pct(hit.length, expected.length)}, wrongly failed ${falsePos.length}`);
    }
    const wrong = rows.filter((o) => !o.agree);
    if (wrong.length) lines.push("Disagreements:");
    for (const o of wrong) {
      lines.push(`  ${o.holdout ? "[held out] " : ""}${o.id.length > 60 ? o.id.slice(0, 60) + "…" : o.id} ${o.title} @ ${o.company}`);
      lines.push(`    expected ${o.expected}, got ${o.actual}${o.note ? ` | ${o.note}` : ""}`);
      if (o.reasons.length) lines.push(`    gates said: ${o.reasons.join("; ")}`);
    }
  }
  return lines.join("\n");
}

const config = loadConfig();
const provider = await createProvider(llmConfig(config));
const started = Date.now();
const outcomes: Outcome[] = [];
const now = new Date("2026-11-02T00:00:00Z");
if (!ONLY || ONLY === "accountant") outcomes.push(...(await runPersona(provider, "accountant", remoteAccountantPersona, accountantPostings, now)));
if (!ONLY || ONLY === "nurse") outcomes.push(...(await runPersona(provider, "nurse", onsiteNursePersona, nursePostings, now)));
if (!ONLY || ONLY === "owner") outcomes.push(...(await runOwner(provider)));

const report = summarise(outcomes);
const cost = outcomes.reduce((n, o) => n + o.costUsd, 0);
const header = `# Enrichment eval, provider ${provider.name}, ${outcomes.length} postings, new spend est $${cost.toFixed(4)}, ${Math.round((Date.now() - started) / 1000)}s`;
console.log(`${header}${report}`);
writeFileSync(join(OUT, "report.md"), `${header}${report}\n`);
writeFileSync(join(OUT, "outcomes.json"), JSON.stringify(outcomes, null, 1));
console.log(`\nWritten to ${join(OUT, "report.md")}`);
