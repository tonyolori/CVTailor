import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  parseAshby,
  parseBreezy,
  parseGreenhouse,
  parseLever,
  parseRecruitee,
  parseWorkable,
  companyRelevant,
  scanCompanies,
  type CompanyRow,
} from "../src/sources/ats";
import {
  AGGREGATORS,
  parseHimalayas,
  parseHnThread,
  parseJobicy,
  parseRemoteOk,
  parseRemotive,
  parseWorkableSearch,
  parseWorkingNomads,
  parseWwr,
} from "../src/sources/aggregators";
import { onsiteNursePersona, remoteAccountantPersona, remoteSoftwarePersona } from "@jobtailor/core";
import { capDescription, dedupeRun } from "../src/pipeline/collect";
import { slugCandidates } from "../src/pipeline/discovery";
import { parseWatchList } from "../src/seed/companies";
import { coverageGaps, relevantAdapters, searchQueries } from "../src/sources/registry";
import { politeHttp } from "../src/sources/http";
import { blockedBySourceRules } from "../src/sources/restricted";
import { dedupeKey, guessCountry, htmlToText, toIso } from "../src/sources/text";
import type { RawJob } from "../src/sources/types";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "../fixtures", name), "utf8");
const json = (name: string) => JSON.parse(fixture(name));
const company: CompanyRow = { id: 1, ats: "gh", slug: "acme", name: "Acme", tags: [], countries: [], fail_count: 0 };

function expectValid(jobs: RawJob[], source: string) {
  expect(jobs.length).toBeGreaterThan(0);
  for (const j of jobs) {
    expect(j.source).toBe(source);
    expect(j.url).toMatch(/^https?:\/\//);
    expect(j.applyUrl).toMatch(/^(https?:|mailto:)/);
    expect(j.title.length).toBeGreaterThan(0);
    expect(j.company.length).toBeGreaterThan(0);
    expect(j.description).not.toMatch(/<\/?(p|div|ul|li)\b/i);
    if (j.postedAt) expect(new Date(j.postedAt).toISOString()).toBe(j.postedAt);
  }
}

describe("aggregator parsers, against saved real responses", () => {
  it("Himalayas keeps applicationLink unchanged and passes the location list", () => {
    const body = json("himalayas.json");
    const jobs = parseHimalayas(body);
    expectValid(jobs, "himalayas");
    expect(jobs[0]!.applyUrl).toBe(body.jobs[0].applicationLink);
    expect(jobs[0]!.atsFields.timezoneRestrictions).toEqual(body.jobs[0].timezoneRestrictions);
    expect(jobs[0]!.workModeHint).toBe("remote");
  });

  it("Remotive parses and treats its timestamp as UTC", () => {
    const jobs = parseRemotive(json("remotive.json"));
    expectValid(jobs, "remotive");
    expect(jobs[0]!.locationText).toBeTruthy();
  });

  it("Remote OK skips the legal notice and keeps the link on Remote OK", () => {
    const jobs = parseRemoteOk(json("remoteok.json"));
    expectValid(jobs, "remoteok");
    expect(jobs).toHaveLength(2);
    expect(jobs[0]!.applyUrl.toLowerCase()).toContain("remoteok.com");
  });

  it("We Work Remotely splits company from title and reads the region", () => {
    const jobs = parseWwr(fixture("wwr.rss"));
    expectValid(jobs, "weworkremotely");
    expect(jobs[0]!.company).toBe("LOTARO");
    expect(jobs[0]!.title).toContain("Head of Lead Generation");
    expect(jobs[0]!.atsFields.region).toBe("Anywhere in the World");
  });

  it("Jobicy keeps apply links on Jobicy", () => {
    const jobs = parseJobicy(json("jobicy.json"));
    expectValid(jobs, "jobicy");
    expect(jobs[0]!.applyUrl).toContain("jobicy.com");
  });

  it("Working Nomads and Workable search parse", () => {
    expectValid(parseWorkingNomads(json("workingnomads.json")), "workingnomads");
    expectValid(parseWorkableSearch(json("workable-search.json")), "workable-search");
  });

  it("Hacker News parses company and role from the first line", () => {
    const thread = {
      id: 1,
      children: [
        { id: 10, created_at: "2026-10-01T15:00:00Z", text: "Acme | Backend Engineer | London, UK | REMOTE<p>We build things. <a href=\"https:&#x2F;&#x2F;acme.example&#x2F;jobs\">apply</a>" },
        { id: 11, created_at: "2026-10-01T15:00:00Z", text: "a comment that is not a posting" },
      ],
    };
    const jobs = parseHnThread(thread);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.company).toBe("Acme");
    expect(jobs[0]!.title).toBe("Backend Engineer");
    expect(jobs[0]!.workModeHint).toBe("remote");
    expect(jobs[0]!.applyUrl).toBe("https://acme.example/jobs");
    expect(jobs[0]!.country).toBe("GB");
  });

  it("Hacker News also reads posts separated by dashes", () => {
    const jobs = parseHnThread({ id: 1, children: [{ id: 12, created_at: "2026-10-01T15:00:00Z", text: "Acme (Remote US) — Full-Stack Software Engineer — TypeScript<p>Hi" }] });
    expect(jobs[0]?.title).toBe("Full-Stack Software Engineer");
    expect(jobs[0]?.company).toBe("Acme (Remote US)");
  });

  it("Hacker News copes with a saved real thread", () => {
    for (const j of parseHnThread(json("hn-item.json"))) expect(j.source).toBe("hackernews");
  });
});

describe("ATS parsers, against saved real responses", () => {
  it("Greenhouse decodes double-escaped HTML and uses first_published", () => {
    const body = json("greenhouse.json");
    const jobs = parseGreenhouse(body, company);
    expectValid(jobs, "greenhouse");
    expect(jobs[0]!.postedAt).toBe(new Date(body.jobs[0].first_published).toISOString());
    expect(jobs[0]!.description).not.toContain("&lt;");
    expect(jobs[0]!.fromAts).toBe(true);
  });

  it("Lever passes allLocations and workplaceType", () => {
    const jobs = parseLever(json("lever.json"), company);
    expectValid(jobs, "lever");
    expect(Array.isArray(jobs[0]!.atsFields.allLocations)).toBe(true);
    expect(jobs[0]!.workModeHint).toBe("hybrid");
  });

  it("Ashby includes secondaryLocations, which decide eligibility", () => {
    const jobs = parseAshby(json("ashby.json"), company);
    expectValid(jobs, "ashby");
    const withSecondary = jobs.find((j) => (j.atsFields.secondaryLocations as string[]).length > 0);
    expect(withSecondary).toBeDefined();
    expect(withSecondary!.locationText).toContain(";");
  });

  it("Workable, Breezy and Recruitee parse", () => {
    const workable = parseWorkable(json("workable.json"), company);
    expectValid(workable, "workable");
    expect(workable[0]!.country).toBe("US");
    const breezy = parseBreezy(json("breezy.json"), company);
    expectValid(breezy, "breezy");
    expect(breezy[0]!.workModeHint).toBe("remote");
    const recruitee = parseRecruitee(json("recruitee.json"), company);
    expectValid(recruitee, "recruitee");
    expect(recruitee[0]!.country).toBe("AT");
  });
});

describe("source terms", () => {
  it("every adapter records its terms", () => {
    for (const a of AGGREGATORS) expect(a.terms.note.length).toBeGreaterThan(10);
  });

  it("Remote Rocketship isn't ported, because its terms prohibit scraping", () => {
    expect(AGGREGATORS.map((a) => a.id)).not.toContain("remoterocketship");
  });

  it("undocumented sources are marked for review", () => {
    expect(AGGREGATORS.find((a) => a.id === "workable-search")?.terms.status).toBe("unverified");
  });
});

describe("scanCompanies", () => {
  it("reports each board's outcome, so failures can be counted", async () => {
    const http = {
      json: vi.fn(async (url: string) => (url.includes("good") ? { jobs: [] } : null)),
      text: vi.fn(),
    };
    const r = await scanCompanies(http as never, [
      { ...company, id: 1, ats: "ashby", slug: "good" },
      { ...company, id: 2, ats: "ashby", slug: "bad" },
    ]);
    expect(r.outcomes.find((o) => o.companyId === 1)?.ok).toBe(true);
    expect(r.outcomes.find((o) => o.companyId === 2)?.ok).toBe(false);
  });

  it("scans only companies relevant to active users", () => {
    const tech = { ...company, tags: ["software-engineering"], countries: [] };
    const hospital = { ...company, tags: ["nursing-healthcare"], countries: ["GB"] };
    const active = new Set(["nursing-healthcare"]);
    expect(companyRelevant(tech, active, "*")).toBe(false);
    expect(companyRelevant(hospital, active, new Set(["GB"]))).toBe(true);
    expect(companyRelevant(hospital, active, new Set(["NG"]))).toBe(false);
  });
});

describe("politeHttp", () => {
  const headers = () => new Headers();

  it("backs off on 429 and 401, then succeeds", async () => {
    const statuses = [429, 401, 200];
    const pauses: number[] = [];
    const fetchFn = vi.fn(async () => {
      const status = statuses.shift()!;
      return new Response(status === 200 ? "{\"ok\":true}" : "", { status, headers: headers() });
    });
    const http = politeHttp({}, fetchFn as never, async (ms) => void pauses.push(ms));
    expect(await http.json("https://example.com/a")).toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(pauses.some((p) => p >= 2000)).toBe(true);
  });

  it("gives up after three attempts and returns null", async () => {
    const fetchFn = vi.fn(async () => new Response("", { status: 429 }));
    const http = politeHttp({}, fetchFn as never, async () => {});
    expect(await http.json("https://example.com/a")).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("doesn't retry a 404", async () => {
    const fetchFn = vi.fn(async () => new Response("", { status: 404 }));
    const http = politeHttp({}, fetchFn as never, async () => {});
    expect(await http.json("https://example.com/a")).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("spaces requests to one host", async () => {
    const pauses: number[] = [];
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 }));
    const http = politeHttp({ "example.com": { minIntervalMs: 5000 } }, fetchFn as never, async (ms) => void pauses.push(ms));
    await Promise.all([http.json("https://example.com/a"), http.json("https://example.com/b")]);
    expect(pauses[0]).toBeGreaterThan(4000);
  });
});

describe("text helpers", () => {
  it("htmlToText handles double-escaped content and lists", () => {
    expect(htmlToText("&lt;p&gt;Hello &amp;amp; bye&lt;/p&gt;&lt;ul&gt;&lt;li&gt;One&lt;/li&gt;&lt;/ul&gt;")).toBe("Hello & bye\n- One");
  });

  it("toIso reads epoch seconds, milliseconds and odd date strings", () => {
    expect(toIso(1793322182)).toBe(new Date(1793322182000).toISOString());
    expect(toIso(1781858910353)).toBe(new Date(1781858910353).toISOString());
    expect(toIso("2026-11-02 10:18:50 UTC")).toBe("2026-11-02T10:18:50.000Z");
    expect(toIso("not a date")).toBeNull();
  });

  it("guessCountry reads names, not fragments", () => {
    expect(guessCountry("Manchester, United Kingdom")).toBe("GB");
    expect(guessCountry("Remote - Germany")).toBe("DE");
    expect(guessCountry("Anywhere")).toBeNull();
  });

  it("dedupeKey ignores company suffixes and punctuation", () => {
    expect(dedupeKey("Acme, Inc.", "Backend Engineer (Remote)")).toBe(dedupeKey("ACME", "backend engineer remote"));
  });
});

describe("source registry", () => {
  const software = remoteSoftwarePersona.preferences;
  const accountant = remoteAccountantPersona.preferences;
  const nurse = onsiteNursePersona.preferences;
  const opts = { billingEnforced: false };

  it("runs only adapters relevant to at least one active user", () => {
    expect(relevantAdapters([nurse], opts).map((a) => a.id)).toEqual([]);
    const forSoftware = relevantAdapters([software], opts).map((a) => a.id);
    expect(forSoftware).toContain("himalayas");
    expect(forSoftware).toContain("hackernews");
    expect(relevantAdapters([accountant], opts).map((a) => a.id)).not.toContain("hackernews");
  });

  it("keeps unverified sources off unless explicitly enabled", () => {
    expect(relevantAdapters([software], opts).map((a) => a.id)).not.toContain("workable-search");
    const on = relevantAdapters([software], { ...opts, enabledUnverified: ["workable-search"] });
    expect(on.map((a) => a.id)).toContain("workable-search");
  });

  it("turns off free-tier-only sources once billing is on", () => {
    expect(relevantAdapters([software], { billingEnforced: true }).map((a) => a.id)).not.toContain("remotive");
  });

  it("says so when no source covers a search", () => {
    const gaps = coverageGaps(nurse, opts, []);
    expect(gaps.map((g) => g.workMode)).toEqual(["hybrid", "onsite"]);
    expect(gaps[1]!.message).toContain("Manchester");
    expect(gaps[1]!.message).toContain("isn't the same as there being no jobs");
  });

  it("reports no gap once a relevant board exists", () => {
    const hospital: CompanyRow = { ...company, tags: ["nursing-healthcare"], countries: ["GB"] };
    expect(coverageGaps(nurse, opts, [hospital])).toEqual([]);
    expect(coverageGaps(software, opts, [])).toEqual([]);
  });

  it("searchQueries de-duplicates across users, main titles first", () => {
    const q = searchQueries([software, software, accountant]);
    expect(q.filter((t) => t === "Backend Engineer")).toHaveLength(1);
    expect(q.indexOf("Senior Accountant")).toBeLessThan(q.indexOf("Platform Engineer"));
  });
});

describe("collection helpers", () => {
  const raw = (over: Partial<RawJob>): RawJob => ({
    url: "https://a/1",
    applyUrl: "https://a/1",
    source: "x",
    company: "Acme",
    title: "Backend Engineer",
    description: "",
    locationText: "",
    workModeHint: null,
    country: null,
    postedAt: null,
    fromAts: false,
    atsFields: {},
    ...over,
  });

  it("prefers the employer's board over an aggregator's copy", () => {
    const out = dedupeRun([
      raw({ url: "https://agg/1", source: "himalayas" }),
      raw({ url: "https://ats/1", source: "ashby", fromAts: true, company: "ACME Inc." }),
      raw({ url: "https://agg/2", source: "remotive" }),
    ]);
    expect(out.map((j) => j.url)).toEqual(["https://ats/1"]);
  });

  it("keeps two ATS postings with the same title, since they can be different cities", () => {
    const out = dedupeRun([raw({ url: "https://ats/1", fromAts: true }), raw({ url: "https://ats/2", fromAts: true })]);
    expect(out).toHaveLength(2);
  });

  it("caps long descriptions at a paragraph boundary", () => {
    const text = `${"a".repeat(29_990)}\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`;
    expect(capDescription(text).endsWith("a")).toBe(true);
    expect(capDescription("short")).toBe("short");
  });

  it("slugCandidates tries likely board slugs", () => {
    expect(slugCandidates("Acme Widgets, Inc.")).toEqual(["acmewidgets", "acme-widgets"]);
    expect(slugCandidates("Acme")).toEqual(["acme"]);
  });

  it("parses the legacy watch-list format", () => {
    const md = `## Notes\n\n- **Acme**: hires worldwide\n\n## Watch list\n\n\`\`\`text\ngh acme\nashby beta\n\`\`\`\n\n## Careers pages\n\n\`\`\`text\npage https://x.example/jobs\n\`\`\`\n\n## Leads\n\n\`\`\`text\nlead Gamma – no board yet\n\`\`\`\n\n## Discovery log\n`;
    const rows = parseWatchList(md);
    expect(rows.map((r) => r.ats)).toEqual(["gh", "ashby", "page", "lead"]);
    expect(rows[0]!.notes).toBe("hires worldwide");
    expect(rows[0]!.tags).toContain("tech");
    expect(rows[3]!.notes).toBe("no board yet");
  });
});

describe("source rules at the HTTP layer", () => {
  it("refuses sites that are out of bounds, whoever is asking", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 }));
    const http = politeHttp({}, fetchFn as never, async () => {});
    for (const url of [
      "https://www.linkedin.com/jobs/view/1",
      "https://www.indeed.com/viewjob?jk=1",
      "https://uk.indeed.com/viewjob?jk=1",
      "https://www.indeed.co.uk/viewjob?jk=1",
      "https://www.remoterocketship.com/jobs/x",
      "https://himalayas.app/companies/acme/jobs/x",
      "https://weworkremotely.com/remote-jobs/acme-x",
      "https://jobs.workable.com/view/abc",
      "https://remoteOK.com/remote-jobs/x",
    ]) {
      expect(await http.text(url), url).toBeNull();
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("still allows each source's published feed or API", () => {
    for (const url of [
      "https://himalayas.app/jobs/api/search?q=nurse",
      "https://weworkremotely.com/remote-jobs.rss",
      "https://remoteok.com/api",
      "https://remotive.com/api/remote-jobs",
      "https://jobicy.com/api/v2/remote-jobs?count=100",
      "https://www.workingnomads.com/api/exposed_jobs/",
      "https://boards-api.greenhouse.io/v1/boards/acme/jobs",
      "https://jobs.ashbyhq.com/acme/1",
    ]) {
      expect(blockedBySourceRules(url), url).toBe(false);
    }
  });

  it("every enabled adapter's own endpoints pass the rules", async () => {
    const asked: string[] = [];
    const http = {
      json: async (url: string) => (asked.push(url), null),
      text: async (url: string) => (asked.push(url), null),
    };
    for (const a of AGGREGATORS) await a.fetch({ http, queries: ["Accountant"], now: new Date() });
    expect(asked.length).toBeGreaterThan(5);
    expect(asked.filter(blockedBySourceRules)).toEqual([]);
  });
});
