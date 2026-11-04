import { beforeAll, describe, expect, it } from "vitest";
import { onsiteNursePersona, PERSONAS, remoteAccountantPersona, remoteSoftwarePersona, type EnrichedJobInput } from "@jobtailor/core";
import { FakeProvider, type LlmRequest } from "@jobtailor/llm";
import { loadConfig } from "../src/config";
import { serviceClient } from "../src/db";
import type { EmailSender, OutgoingEmail } from "../src/email/send";
import { processAiTasks } from "../src/pipeline/ai-tasks";
import { Budget } from "../src/pipeline/budget";
import { runDaily, tick, type RunDeps } from "../src/pipeline/run";
import { storeJobs } from "../src/pipeline/collect";
import { upsertUser } from "../src/seed/users";
import type { Http } from "../src/sources/http";
import type { RawJob } from "../src/sources/types";

/**
 * The whole pipeline for all three personas against local Supabase, with the network and
 * the model faked. Proves: shared jobs, per-user matches, CVs and PDFs, queued emails, a
 * runs cost record, and no code path special-cased for any persona.
 */
const config = loadConfig();

if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(config.SUPABASE_URL)) {
  throw new Error("This suite wipes and rewrites data, so it only runs against local Supabase.");
}
const db = serviceClient(config);
const NOW = new Date("2026-11-02T03:00:00Z");
const RUN_DATE = "2026-11-02";
const SUFFIX = `-${Date.now()}`;

const posted = "2026-10-28T00:00:00.000Z";
const raw = (id: string, title: string, company: string, locationText: string, description: string, mode: RawJob["workModeHint"] = "remote"): RawJob => ({
  url: `https://ats.example/${id}${SUFFIX}`,
  applyUrl: `https://ats.example/${id}${SUFFIX}`,
  source: "greenhouse",
  company: `${company}${SUFFIX}`,
  title,
  description,
  locationText,
  workModeHint: mode,
  country: null,
  postedAt: posted,
  fromAts: true,
  atsFields: {},
});

const JOBS: RawJob[] = [
  raw("software-pass", "Backend Engineer", "Northwind", "Remote, worldwide", "TYPE=software-pass"),
  raw("software-limited", "Backend Engineer", "Limited Co", "Remote, Germany", "TYPE=software-limited"),
  raw("accountant-pass", "Senior Accountant", "Vela", "Remote, EU", "TYPE=accountant-pass"),
  raw("nurse-pass", "Staff Nurse", "Northern Care", "Manchester, UK", "TYPE=nurse-pass", "onsite"),
  raw("nurse-other-city", "Staff Nurse", "Pennine", "Leeds, UK", "TYPE=nurse-other-city", "onsite"),
  raw("nurse-invent", "Registered Nurse", "Oakfield", "Manchester, UK", "TYPE=nurse-invent", "onsite"),
];

const base = { isOpen: true, postedAt: posted, seniority: "mid" as const };
const ENRICHED: Record<string, EnrichedJobInput> = {
  "software-pass": { ...base, workMode: "remote", worldwide: true, category: "software-engineering", employerBase: { country: "DE", regions: ["EU"] }, asksForCoverLetter: true, applicantInstructions: ["Use the word PINEAPPLE."] },
  "software-limited": { ...base, workMode: "remote", eligibleCountries: ["DE"], category: "software-engineering", employerBase: { country: "DE", regions: ["EU"] }, locationQuote: "Remote, Germany" },
  "accountant-pass": { ...base, workMode: "remote", eligibleRegions: ["EU"], category: "accounting-finance" },
  "nurse-pass": { ...base, workMode: "onsite", locations: [{ country: "GB", city: "Manchester" }], category: "nursing-healthcare", requiredCredentials: ["NMC Registration"] },
  "nurse-other-city": { ...base, workMode: "onsite", locations: [{ country: "GB", city: "Leeds" }], category: "nursing-healthcare" },
  "nurse-invent": { ...base, workMode: "onsite", locations: [{ country: "GB", city: "Manchester" }], category: "nursing-healthcare" },
};

const DRAFTS: Record<string, unknown> = {
  "Sade Testperson": {
    roleTitle: "Backend Engineer",
    summary: "Backend engineer who built a payouts API used by 40 merchants.",
    skills: [{ group: "Languages", items: ["TypeScript", "PostgreSQL"] }],
    experience: [{ title: "Backend Engineer", company: "Northwind Payments", start: "2023-02", end: null, bullets: ["Built a payouts API used by 40 merchants."] }],
    education: [{ degree: "BSc Computer Science", school: "University of Ibadan" }],
  },
  "Marta Exemplo": {
    roleTitle: "Senior Accountant",
    summary: "Accountant who cut the month-end close from 10 days to 6 days.",
    skills: [{ group: "Technical", items: ["IFRS", "SAP"] }],
    credentials: [{ name: "ACCA", issuer: "Association of Chartered Certified Accountants", year: "2019" }],
    experience: [{ title: "Senior Accountant", company: "Atlantico Logistica", start: "2020-06", end: null, bullets: ["Cut the month-end close from 10 days to 6 days for 4 legal entities."] }],
    education: [{ degree: "Licenciatura in Accounting", school: "Universidade do Minho" }],
  },
  "Grace Sampleton": {
    roleTitle: "Staff Nurse",
    summary: "Nurse with experience on a 28-bed acute medical ward.",
    skills: [{ group: "Clinical", items: ["Wound care", "Care planning"] }],
    credentials: [{ name: "NMC Registration", issuer: "Nursing and Midwifery Council", year: "2018" }],
    experience: [{ title: "Staff Nurse", company: "Riverside Community Hospital", start: "2018-09", end: null, bullets: ["Cared for up to 8 patients per shift."] }],
    education: [{ degree: "BSc Adult Nursing", school: "University of Salford" }],
    sectionOrder: ["credentials", "summary", "experience", "skills", "education"],
  },
};

function fakeModel(req: LlmRequest<unknown>, user: string): unknown {
  const type = user.match(/TYPE=([a-z-]+)/)?.[1];
  // Every prompt carrying a library must carry exactly one person's.
  const names = Object.keys(DRAFTS).filter((n) => req.cachedContext?.includes(n));
  if (req.cachedContext) expect(names).toHaveLength(1);

  if (req.system.includes("into structured data")) return ENRICHED[type!];
  if (req.system.includes("You score how well")) return { roleMatch: 5, libraryFit: 4, reason: "Good fit" };
  if (req.system.includes("You write a tailored CV")) {
    if (type === "nurse-invent") return { ...(DRAFTS["Grace Sampleton"] as object), credentials: [{ name: "Doctor of Medicine" }] };
    return DRAFTS[names[0]!];
  }
  if (req.system.includes("You write a cover letter")) {
    return { subject: "Northwind – Backend Engineer", salutation: "Dear Hiring Team,", paragraphs: ["I built a payouts API used by 40 merchants.", "I reduced failed payouts from 3% to 0.5%."], signOff: "Kind regards," };
  }
  throw new Error("unexpected request");
}

const sent: OutgoingEmail[] = [];
const sender: EmailSender = {
  async send(email) {
    sent.push(email);
    return { id: `fake-${sent.length}` };
  },
};
const http: Http = { json: async () => null, text: async () => null };
const provider = new FakeProvider(fakeModel);
const deps = (now: Date, over: Partial<RunDeps["config"]> = {}): RunDeps => ({
  db,
  http,
  provider,
  sender,
  now: () => now,
  config: {
    OWNER_EMAIL: "owner-not-used@example.com",
    GLOBAL_DAILY_BUDGET_USD: 50,
    USER_DAILY_BUDGET_USD: 10,
    ENRICH_MAX_PER_RUN: 300,
    BILLING_ENFORCED: false,
    ENABLED_UNVERIFIED_SOURCES: [],
    RUN_START_HOUR_UTC: 1,
    RUN_ALERT_HOUR_UTC: 6,
    EMAIL_FROM: "J <j@example.com>",
    SITE_URL: "https://app.example",
    ...over,
  },
});

const ids = new Map<string, string>();
let realUser: string;

beforeAll(async () => {
  await db.from("daily_runs").delete().not("run_date", "is", null);
  await db.from("daily_summaries").delete().not("run_date", "is", null);
  await db.from("match_scores").delete().not("job_id", "is", null);
  for (const table of ["documents", "resume_versions", "matches", "runs", "ai_tasks"]) {
    await db.from(table).delete().not("id", "is", null);
  }
  await db.from("jobs").delete().not("id", "is", null);
  await db.from("companies").delete().not("id", "is", null);
  for (const p of PERSONAS) {
    ids.set(p.key, await upsertUser(db, { email: p.email, displayName: p.displayName, tz: p.tz, isSynthetic: true, preferences: p.preferences, facts: p.facts }));
  }
  // A real, non-owner user: subscription mode must not run AI for them.
  realUser = await upsertUser(db, {
    email: "friend.test@jobtailor.test",
    displayName: "Friend",
    tz: "UTC",
    isSynthetic: false,
    preferences: remoteSoftwarePersona.preferences,
    facts: remoteSoftwarePersona.facts,
  });
  // Earlier runs of this suite leave people paused and switches flipped. Start clean.
  await db.from("app_settings").update({ value: false }).eq("key", "kill_switch");
  await db.from("profiles").update({ active: false }).not("id", "is", null);
  await db.from("profiles").update({ active: true, email_paused: false }).in("id", [...ids.values()]);
  await storeJobs(db, JOBS);
});

const matchesFor = async (key: string) => {
  const { data } = await db
    .from("matches")
    .select("id,decision,tailor_status,tailor_error,score,gate_failures,jobs(title,raw_text)")
    .eq("user_id", ids.get(key)!);
  return (data ?? []) as unknown as { id: number; decision: string; tailor_status: string; tailor_error: string | null; score: number; gate_failures: string[]; jobs: { title: string; raw_text: string } }[];
};
const byType = (rows: Awaited<ReturnType<typeof matchesFor>>, type: string) => rows.find((r) => r.jobs.raw_text.includes(`TYPE=${type}`));

describe("real collection volumes", () => {
  // A real run fetched over 6,000 postings, and a long filter list fails with "URI too long".
  it("stores and re-sees thousands of postings with long URLs and awkward characters", async () => {
    const many = Array.from({ length: 1200 }, (_, i) => ({
      ...raw(`bulk-${i}`, `Senior Backend Engineer, Payments (Remote) ${i}`, `Company, "Inc" (${i})`, "Remote", "x"),
      url: `https://job-boards.greenhouse.io/a-rather-long-company-name/jobs/${9000000000 + i}?gh_src=a,b(c)"d"${SUFFIX}`,
    }));
    expect(await storeJobs(db, many)).toBe(1200);
    expect(await storeJobs(db, many)).toBe(0);
    await db.from("jobs").delete().like("company", 'Company, "Inc"%');
  }, 60_000);
});

describe("a full morning run", () => {
  beforeAll(async () => {
    await runDaily(deps(NOW), RUN_DATE);
  });

  it("enriches each posting once, shared by all users", async () => {
    const { data } = await db.from("jobs").select("status,category");
    expect(data).toHaveLength(JOBS.length);
    expect(data!.every((j) => j.status === "verified")).toBe(true);
    const enrichCalls = provider.requests.filter((r) => r.system.includes("into structured data"));
    expect(enrichCalls).toHaveLength(JOBS.length);
  });

  it("remote software persona: picks the worldwide role, near-misses the Germany-only one", async () => {
    const rows = await matchesFor("remote-software");
    expect(byType(rows, "software-pass")?.decision).toBe("picked");
    expect(byType(rows, "software-pass")?.tailor_status).toBe("none");
    expect(byType(rows, "software-limited")?.decision).toBe("worth-a-look");
    expect(byType(rows, "nurse-pass")?.decision).toBe("skipped");
  });

  it("remote accountant persona: picks the EU role, ignores other professions", async () => {
    const rows = await matchesFor("remote-accountant");
    expect(byType(rows, "accountant-pass")?.decision).toBe("picked");
    expect(byType(rows, "accountant-pass")?.tailor_status).toBe("none");
    expect(byType(rows, "software-pass")?.decision).toBe("skipped");
  });

  it("on-site nurse persona: picks Manchester, near-misses Leeds", async () => {
    const rows = await matchesFor("onsite-nurse");
    expect(byType(rows, "nurse-pass")?.decision).toBe("picked");
    expect(byType(rows, "nurse-pass")?.tailor_status).toBe("none");
    expect(byType(rows, "nurse-other-city")?.gate_failures).toEqual(["location"]);
  });

  it("writes no CVs, and spends nothing on them", async () => {
    expect(provider.requests.filter((r) => r.system.includes("You write a tailored CV"))).toEqual([]);
    const { data: versions } = await db.from("resume_versions").select("id");
    expect(versions).toEqual([]);
    const { data: docs } = await db.from("documents").select("id");
    expect(docs).toEqual([]);
  });

  it("surfaces posting instructions in the summary", async () => {
    const { data } = await db.from("daily_summaries").select("data").eq("user_id", ids.get("remote-software")!).eq("run_date", RUN_DATE).single();
    expect((data!.data as { roles: { note: string }[] }).roles[0]!.note).toContain("PINEAPPLE");
  });

  it("says when no source covers a search, rather than returning nothing silently", async () => {
    const { data } = await db.from("daily_summaries").select("data").eq("user_id", ids.get("onsite-nurse")!).eq("run_date", RUN_DATE).single();
    const gaps = (data!.data as { gaps: string[] }).gaps;
    expect(gaps.join(" ")).toContain("Manchester");
  });

  it("queues each email for the user's send time, in their zone", async () => {
    const { data } = await db.from("daily_summaries").select("send_at,status").eq("user_id", ids.get("remote-software")!).eq("run_date", RUN_DATE).single();
    expect(new Date(data!.send_at).toISOString()).toBe("2026-11-02T07:00:00.000Z");
    expect(data!.status).toBe("pending");
  });

  it("records cost per stage in runs", async () => {
    const { data } = await db.from("runs").select("stage,cost_usd,user_id,provider").eq("run_date", RUN_DATE);
    const stages = new Set(data!.map((r) => r.stage));
    for (const s of ["collect", "enrich", "match"]) expect(stages).toContain(s);
    expect(data!.find((r) => r.stage === "enrich")?.user_id).toBeNull();
    const total = data!.reduce((n, r) => n + Number(r.cost_usd), 0);
    expect(total).toBeGreaterThan(0);
  });
});

/** What the web route does when someone clicks: billing is off here, so no CV is taken. */
async function askForCvs(key: string): Promise<void> {
  const id = ids.get(key)!;
  for (const r of (await matchesFor(key)).filter((m) => m.decision === "picked")) {
    await db.from("matches").update({ tailor_status: "pending" }).eq("id", r.id);
    await db.from("ai_tasks").insert({ user_id: id, kind: "tailor_match", input: {}, match_id: r.id, cv_bucket: "none" });
  }
}

async function runTasks(): Promise<void> {
  const budget = new Budget(db, "fake", { globalUsd: 50, userUsd: 10 }, RUN_DATE);
  await budget.load();
  while ((await processAiTasks(db, provider, budget, "owner-not-used@example.com")) > 0);
}

describe("CVs when someone asks", () => {
  beforeAll(async () => {
    for (const p of PERSONAS) await askForCvs(p.key);
    await runTasks();
  });

  it("writes a CV for every persona's picks", async () => {
    expect(byType(await matchesFor("remote-software"), "software-pass")?.tailor_status).toBe("rendered");
    expect(byType(await matchesFor("remote-accountant"), "accountant-pass")?.tailor_status).toBe("rendered");
    expect(byType(await matchesFor("onsite-nurse"), "nurse-pass")?.tailor_status).toBe("rendered");
  });

  it("a CV with an invented credential is never delivered", async () => {
    const rows = await matchesFor("onsite-nurse");
    const bad = byType(rows, "nurse-invent");
    expect(bad?.tailor_status).toBe("failed");
    expect(bad?.tailor_error).toBe("failed_fact_check");
    const { data: versions } = await db.from("resume_versions").select("id").eq("match_id", bad!.id);
    expect(versions).toEqual([]);
    const { data: docs } = await db.from("documents").select("id").eq("match_id", bad!.id);
    expect(docs).toEqual([]);
  });

  it("stores CVs and PDFs under the user's own folder", async () => {
    const id = ids.get("remote-software")!;
    const { data: docs } = await db.from("documents").select("kind,storage_path").eq("user_id", id);
    expect(docs!.map((d) => d.kind).sort()).toEqual(["cover_letter_pdf", "resume_pdf"]);
    for (const d of docs!) {
      expect(d.storage_path.startsWith(`${id}/`)).toBe(true);
      const dl = await db.storage.from("documents").download(d.storage_path);
      expect(Buffer.from(await dl.data!.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
    }
    const { data: versions } = await db.from("resume_versions").select("source").eq("user_id", id);
    expect(versions!.every((v) => v.source === "ai")).toBe(true);
  });

  it("orders sections for the occupation", async () => {
    const { data } = await db.from("resume_versions").select("json").eq("user_id", ids.get("onsite-nurse")!).eq("kind", "resume").limit(1).single();
    expect((data!.json as { sectionOrder: string[] }).sectionOrder[0]).toBe("credentials");
  });

  it("records the cost against the person who asked", async () => {
    const { data } = await db.from("runs").select("stage,user_id").eq("run_date", RUN_DATE).eq("stage", "tailor");
    expect(data!.length).toBeGreaterThan(0);
    expect(data!.every((r) => r.user_id)).toBe(true);
  });

  it("a later morning run keeps the CV a job already has", async () => {
    await runDaily(deps(NOW), RUN_DATE);
    expect(byType(await matchesFor("remote-software"), "software-pass")?.tailor_status).toBe("rendered");
  });
});

describe("resuming", () => {
  it("a second run pays for nothing again", async () => {
    const before = provider.requests.length;
    await runDaily(deps(NOW), RUN_DATE);
    expect(provider.requests.length).toBe(before);
    const { data } = await db.from("resume_versions").select("id").eq("user_id", ids.get("remote-software")!).eq("kind", "resume");
    expect(data).toHaveLength(1);
  });

  it("a stored draft with no PDF is rendered without calling the model", async () => {
    const id = ids.get("remote-accountant")!;
    await db.from("documents").delete().eq("user_id", id);
    await db.from("matches").update({ tailor_status: "drafted" }).eq("user_id", id).eq("decision", "picked");
    const before = provider.requests.length;
    const row = byType(await matchesFor("remote-accountant"), "accountant-pass")!;
    await db.from("ai_tasks").insert({ user_id: id, kind: "tailor_match", input: {}, match_id: row.id, cv_bucket: "none" });
    await runTasks();
    expect(provider.requests.length).toBe(before);
    const { data } = await db.from("documents").select("kind").eq("user_id", id);
    expect(data!.map((d) => d.kind)).toEqual(["resume_pdf"]);
    const rows = await matchesFor("remote-accountant");
    expect(byType(rows, "accountant-pass")?.tailor_status).toBe("rendered");
  });
});

describe("email", () => {
  it("nothing goes before the send time; then one email with PDFs, once", async () => {
    await tick(deps(new Date("2026-11-02T05:00:00Z")));
    expect(sent).toHaveLength(0);

    await db.from("daily_runs").upsert({ run_date: RUN_DATE, status: "ok" });
    await tick(deps(new Date("2026-11-02T07:01:00Z")));
    const mine = sent.filter((m) => m.to === remoteSoftwarePersona.email);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.subject).toContain("1 role");
    expect(mine[0]!.attachments!.map((a) => a.filename).sort()).toEqual(expect.arrayContaining([expect.stringMatching(/^CV-/), expect.stringMatching(/^Cover-letter-/)]));
    expect(mine[0]!.attachments![0]!.content.subarray(0, 5).toString()).toBe("%PDF-");
    expect(mine[0]!.headers!["List-Unsubscribe"]).toContain("token=");

    const count = sent.length;
    await tick(deps(new Date("2026-11-02T07:30:00Z")));
    expect(sent.length).toBe(count);
  });

  it("a re-run doesn't resend what's already sent", async () => {
    // The other personas' send times come an hour later, in their own zones.
    await tick(deps(new Date("2026-11-02T08:30:00Z")));
    const count = sent.length;
    expect(count).toBe(3);
    await runDaily(deps(new Date("2026-11-02T09:00:00Z")), RUN_DATE);
    await tick(deps(new Date("2026-11-02T09:30:00Z")));
    expect(sent.length).toBe(count);
  });

  it("respects the pause switch", async () => {
    const id = ids.get("remote-accountant")!;
    await db.from("profiles").update({ email_paused: true }).eq("id", id);
    await db.from("daily_summaries").upsert({ user_id: id, run_date: "2026-11-03", data: { date: "2026-11-03", sources: [], roles: [] }, send_at: "2026-11-03T08:00:00Z", status: "pending" });
    const count = sent.length;
    await db.from("daily_runs").upsert({ run_date: "2026-11-03", status: "ok" });
    await tick(deps(new Date("2026-11-03T09:00:00Z")));
    expect(sent.filter((m) => m.to === remoteAccountantPersona.email).length).toBe(sent.slice(0, count).filter((m) => m.to === remoteAccountantPersona.email).length);
    const { data } = await db.from("daily_summaries").select("status").eq("user_id", id).eq("run_date", "2026-11-03").single();
    expect(data!.status).toBe("skipped");
    await db.from("profiles").update({ email_paused: false }).eq("id", id);
  });
});

describe("worker catch-up and alerts", () => {
  it("a worker started mid-day runs the missed day, then alerts only if it's still missing", async () => {
    await db.from("profiles").update({ active: false }).neq("email", "nobody@example.com");
    const before = sent.length;
    const decision = await tick(deps(new Date("2026-11-04T15:00:00Z")));
    expect(decision).toBe("run");
    const { data } = await db.from("daily_runs").select("status").eq("run_date", "2026-11-04").single();
    expect(data!.status).toBe("ok");
    expect(sent.length).toBe(before);
  });

  it("alerts the owner when a run has failed by the alert hour", async () => {
    await db.from("daily_runs").upsert({ run_date: "2026-11-05", status: "running", started_at: "2026-11-05T05:59:00Z" });
    const before = sent.length;
    await tick(deps(new Date("2026-11-05T06:30:00Z")));
    const alerts = sent.slice(before).filter((m) => m.subject.includes("no completed run"));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.to).toBe("owner-not-used@example.com");
    await tick(deps(new Date("2026-11-05T06:45:00Z")));
    expect(sent.slice(before).filter((m) => m.subject.includes("no completed run"))).toHaveLength(1);
  });
});

describe("subscription mode only serves the owner and synthetic personas", () => {
  const subscription = () => {
    const p = new FakeProvider(fakeModel);
    return Object.assign(Object.create(FakeProvider.prototype), p, { name: "claude-subscription" as const, requests: p.requests, complete: p.complete.bind(p), completeMany: p.completeMany.bind(p) }) as FakeProvider;
  };

  it("gates still run for a real user, but no AI does, and they're told why", async () => {
    await db.from("profiles").update({ active: false }).neq("id", realUser);
    await db.from("profiles").update({ active: true }).eq("id", realUser);
    const p = subscription();
    await runDaily({ ...deps(new Date("2026-11-06T03:00:00Z")), provider: p as never, config: { ...deps(NOW).config, OWNER_EMAIL: "tony@example.com" } }, "2026-11-06");
    const withLibrary = p.requests.filter((r) => r.cachedContext);
    expect(withLibrary).toEqual([]);
    const { data } = await db.from("matches").select("decision,score").eq("user_id", realUser).eq("decision", "unscored");
    expect(data!.length).toBeGreaterThan(0);
    const { data: versions } = await db.from("resume_versions").select("id").eq("user_id", realUser);
    expect(versions).toEqual([]);
    const { data: summary } = await db.from("daily_summaries").select("data").eq("user_id", realUser).eq("run_date", "2026-11-06").single();
    expect((summary!.data as { notes: string[] }).notes.join(" ")).toContain("need an API key");
  });

  it("onboarding AI tasks are skipped for them too, and the CV text is erased", async () => {
    const p = subscription();
    const budget = new Budget(db, "claude-subscription", { globalUsd: 50, userUsd: 10 }, "2026-11-06");
    await budget.load();
    const { data: task } = await db.from("ai_tasks").insert({ user_id: realUser, kind: "extract_facts", input: { cvText: "PRIVATE CV TEXT" } }).select("id").single();
    await processAiTasks(db, p as never, budget, "tony@example.com");
    expect(p.requests).toEqual([]);
    const { data } = await db.from("ai_tasks").select("status,input,error").eq("id", task!.id).single();
    expect(data!.status).toBe("skipped");
    expect(data!.input).toEqual({});
    expect(data!.error).toContain("API key");
  });

  it("the API provider serves the same user", async () => {
    await db.from("matches").delete().eq("user_id", realUser);
    const p = new FakeProvider(fakeModel);
    await runDaily({ ...deps(new Date("2026-11-07T03:00:00Z")), provider: p }, "2026-11-07");
    const { data } = await db.from("matches").select("decision").eq("user_id", realUser).eq("decision", "picked");
    expect(data!.length).toBeGreaterThan(0);
  });
});

describe("budgets", () => {
  it("a spent user budget stops their AI work, and the run still finishes", async () => {
    await db.from("matches").delete().eq("user_id", realUser);
    await db.from("match_scores").delete().eq("user_id", realUser);
    await db.from("runs").insert({ run_date: "2026-11-08", user_id: realUser, stage: "tailor", status: "ok", cost_usd: 1 });
    const p = new FakeProvider(fakeModel);
    await runDaily({ ...deps(new Date("2026-11-08T03:00:00Z")), provider: p, config: { ...deps(NOW).config, USER_DAILY_BUDGET_USD: 0.5 } }, "2026-11-08");
    expect(p.requests.filter((r) => r.cachedContext)).toEqual([]);
    const { data: summary } = await db.from("daily_summaries").select("data").eq("user_id", realUser).eq("run_date", "2026-11-08").single();
    expect((summary!.data as { notes: string[] }).notes.join(" ")).toContain("usage limit");
  });

  it("the kill switch stops all AI work", async () => {
    await db.from("app_settings").update({ value: true }).eq("key", "kill_switch");
    await db.from("jobs").update({ status: "new" }).eq("url", JOBS[0]!.url);
    const p = new FakeProvider(fakeModel);
    await runDaily({ ...deps(new Date("2026-11-09T03:00:00Z")), provider: p }, "2026-11-09");
    expect(p.requests).toEqual([]);
    await db.from("app_settings").update({ value: false }).eq("key", "kill_switch");
    await db.from("jobs").update({ status: "verified" }).eq("url", JOBS[0]!.url);
  });
});
