import type { FetchContext, RawJob, SourceAdapter } from "./types";
import { decodeEntities, guessCountry, htmlToText, toIso } from "./text";

const asArray = <T>(v: T[] | null | undefined): T[] => (Array.isArray(v) ? v : []);

// ---------------------------------------------------------------------------
// Himalayas
// ---------------------------------------------------------------------------
interface HimalayasJob {
  title: string;
  companyName: string;
  description?: string;
  excerpt?: string;
  locationRestrictions?: unknown[];
  timezoneRestrictions?: number[];
  pubDate?: number;
  expiryDate?: number;
  applicationLink: string;
  guid: string;
  minSalary?: number | null;
  maxSalary?: number | null;
  salaryPeriod?: string;
  currency?: string;
  seniority?: string[];
}

export function parseHimalayas(body: { jobs?: HimalayasJob[] }): RawJob[] {
  return asArray(body.jobs).map((j) => {
    const restrictions = asArray(j.locationRestrictions).map(String);
    return {
      url: j.guid,
      applyUrl: j.applicationLink,
      source: "himalayas",
      company: j.companyName,
      title: j.title,
      description: htmlToText(j.description ?? j.excerpt),
      locationText: restrictions.length ? restrictions.join(", ") : "Worldwide (per Himalayas)",
      workModeHint: "remote",
      country: null,
      postedAt: toIso(j.pubDate),
      fromAts: false,
      atsFields: {
        locationRestrictions: restrictions,
        timezoneRestrictions: asArray(j.timezoneRestrictions),
        salary: { min: j.minSalary ?? null, max: j.maxSalary ?? null, period: j.salaryPeriod, currency: j.currency },
        seniority: asArray(j.seniority),
        expiresAt: toIso(j.expiryDate),
      },
    };
  });
}

export const himalayas: SourceAdapter = {
  id: "himalayas",
  label: "Himalayas",
  countries: "*",
  categories: "*",
  workModes: ["remote"],
  rateLimit: { host: "himalayas.app", minIntervalMs: 1100 },
  terms: {
    status: "permitted",
    note: "himalayas.app/api: show jobs only on our own sites and apps, keep applicationLink unchanged, show a visible link to Himalayas, remove expired jobs, never pass them to other boards. Data refreshes daily.",
  },
  async fetch(ctx) {
    const out: RawJob[] = [];
    for (const q of ctx.queries) {
      const body = await ctx.http.json<{ jobs?: HimalayasJob[] }>(
        `https://himalayas.app/jobs/api/search?q=${encodeURIComponent(q)}`,
      );
      if (body) out.push(...parseHimalayas(body));
    }
    return out;
  },
};

// ---------------------------------------------------------------------------
// Remotive
// ---------------------------------------------------------------------------
interface RemotiveJob {
  url: string;
  title: string;
  company_name: string;
  category?: string;
  publication_date?: string;
  candidate_required_location?: string;
  salary?: string;
  description?: string;
}

export function parseRemotive(body: { jobs?: RemotiveJob[] }): RawJob[] {
  return asArray(body.jobs).map((j) => ({
    url: j.url,
    applyUrl: j.url,
    source: "remotive",
    company: j.company_name,
    title: j.title,
    description: htmlToText(j.description),
    locationText: j.candidate_required_location ?? "",
    workModeHint: "remote",
    country: guessCountry(j.candidate_required_location),
    postedAt: toIso(j.publication_date ? `${j.publication_date}Z` : null),
    fromAts: false,
    atsFields: { candidate_required_location: j.candidate_required_location, salary: j.salary, category: j.category },
  }));
}

export const remotive: SourceAdapter = {
  id: "remotive",
  label: "Remotive",
  countries: "*",
  categories: "*",
  workModes: ["remote"],
  rateLimit: { host: "remotive.com", minIntervalMs: 2000 },
  terms: {
    status: "permitted",
    blockedWhenPaid: true,
    note: "remotive.com/remote-jobs/api: link back to Remotive and name it as source; no resubmitting to third parties; not to be shown to collect signups or email addresses; commercial use goes through their paid API. Fine for invite-only testing, off once billing is on.",
  },
  async fetch(ctx) {
    const body = await ctx.http.json<{ jobs?: RemotiveJob[] }>("https://remotive.com/api/remote-jobs");
    return body ? parseRemotive(body) : [];
  },
};

// ---------------------------------------------------------------------------
// Remote OK
// ---------------------------------------------------------------------------
interface RemoteOkItem {
  legal?: string;
  url?: string;
  apply_url?: string;
  company?: string;
  position?: string;
  description?: string;
  location?: string;
  date?: string;
  tags?: string[];
  salary_min?: number;
  salary_max?: number;
}

export function parseRemoteOk(body: RemoteOkItem[]): RawJob[] {
  // The first item is the legal notice.
  return asArray(body)
    .filter((j) => j.url && j.position)
    .map((j) => ({
      url: j.url!,
      // Terms ask that we link back to the URL on Remote OK.
      applyUrl: j.url!,
      source: "remoteok",
      company: j.company ?? "",
      title: j.position!,
      description: htmlToText(j.description),
      locationText: j.location ?? "",
      workModeHint: "remote",
      country: guessCountry(j.location),
      postedAt: toIso(j.date),
      fromAts: false,
      atsFields: { location: j.location, tags: asArray(j.tags), salary_min: j.salary_min, salary_max: j.salary_max },
    }));
}

export const remoteOk: SourceAdapter = {
  id: "remoteok",
  label: "Remote OK",
  countries: "*",
  categories: "*",
  workModes: ["remote"],
  rateLimit: { host: "remoteok.com", minIntervalMs: 2000 },
  terms: {
    status: "permitted",
    note: "API legal notice: link back to the URL on Remote OK (no nofollow) and name Remote OK as source. Do not use its logo.",
  },
  async fetch(ctx) {
    const body = await ctx.http.json<RemoteOkItem[]>("https://remoteok.com/api");
    return body ? parseRemoteOk(body) : [];
  },
};

// ---------------------------------------------------------------------------
// We Work Remotely
// ---------------------------------------------------------------------------
function tag(item: string, name: string): string {
  const m = item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  if (!m) return "";
  return m[1]!.replace(/^<!\[CDATA\[|\]\]>$/g, "").trim();
}

export function parseWwr(xml: string): RawJob[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].flatMap(([, item]) => {
    const raw = decodeEntities(tag(item!, "title"));
    const colon = raw.indexOf(":");
    const url = tag(item!, "link") || tag(item!, "guid");
    if (!url || colon < 0) return [];
    const region = decodeEntities(tag(item!, "region"));
    const country = decodeEntities(tag(item!, "country"));
    return [
      {
        url,
        applyUrl: url,
        source: "weworkremotely",
        company: raw.slice(0, colon).trim(),
        title: raw.slice(colon + 1).trim(),
        description: htmlToText(tag(item!, "description")),
        locationText: [region, country].filter(Boolean).join(", "),
        workModeHint: "remote" as const,
        country: guessCountry(country),
        postedAt: toIso(tag(item!, "pubDate")),
        fromAts: false,
        atsFields: { region, country, state: decodeEntities(tag(item!, "state")), category: decodeEntities(tag(item!, "category")) },
      },
    ];
  });
}

export const weWorkRemotely: SourceAdapter = {
  id: "weworkremotely",
  label: "We Work Remotely",
  countries: "*",
  categories: "*",
  workModes: ["remote"],
  rateLimit: { host: "weworkremotely.com", minIntervalMs: 3000 },
  terms: {
    status: "public_feed",
    note: "Public RSS feed. Job pages answer 403 to scripts, so only the feed is read. Its region labels are often wrong: 'Anywhere in the World' has been attached to country-locked roles, so every hit needs live verification.",
  },
  async fetch(ctx) {
    const xml = await ctx.http.text("https://weworkremotely.com/remote-jobs.rss");
    return xml ? parseWwr(xml) : [];
  },
};

// ---------------------------------------------------------------------------
// Jobicy
// ---------------------------------------------------------------------------
interface JobicyJob {
  url: string;
  jobTitle: string;
  companyName: string;
  jobIndustry?: string[];
  jobGeo?: string;
  jobLevel?: string;
  jobDescription?: string;
  jobExcerpt?: string;
  pubDate?: string;
}

export function parseJobicy(body: { jobs?: JobicyJob[] }): RawJob[] {
  return asArray(body.jobs).map((j) => ({
    url: j.url,
    // Terms: apply links from the free API must keep pointing at Jobicy.
    applyUrl: j.url,
    source: "jobicy",
    company: j.companyName,
    title: j.jobTitle,
    description: htmlToText(j.jobDescription ?? j.jobExcerpt),
    locationText: j.jobGeo ?? "",
    workModeHint: "remote",
    country: guessCountry(j.jobGeo),
    postedAt: toIso(j.pubDate),
    fromAts: false,
    atsFields: { jobGeo: j.jobGeo, jobLevel: j.jobLevel, jobIndustry: asArray(j.jobIndustry) },
  }));
}

export const jobicy: SourceAdapter = {
  id: "jobicy",
  label: "Jobicy",
  countries: "*",
  categories: "*",
  workModes: ["remote"],
  rateLimit: { host: "jobicy.com", minIntervalMs: 5000 },
  terms: {
    status: "permitted",
    note: "jobicy.com/jobs-rss-feed: credit Jobicy with a clickable source link, keep apply links on Jobicy, cache responses, at most one sync an hour. No misleading job databases.",
  },
  async fetch(ctx) {
    const body = await ctx.http.json<{ jobs?: JobicyJob[] }>("https://jobicy.com/api/v2/remote-jobs?count=100");
    return body ? parseJobicy(body) : [];
  },
};

// ---------------------------------------------------------------------------
// Working Nomads
// ---------------------------------------------------------------------------
interface NomadJob {
  url: string;
  title: string;
  description?: string;
  company_name: string;
  category_name?: string;
  tags?: string;
  location?: string;
  pub_date?: string;
}

export function parseWorkingNomads(body: NomadJob[]): RawJob[] {
  return asArray(body).map((j) => ({
    url: j.url,
    applyUrl: j.url,
    source: "workingnomads",
    company: j.company_name,
    title: j.title,
    description: htmlToText(j.description),
    locationText: j.location ?? "",
    workModeHint: "remote",
    country: guessCountry(j.location),
    postedAt: toIso(j.pub_date),
    fromAts: false,
    atsFields: { location: j.location, category: j.category_name, tags: j.tags },
  }));
}

export const workingNomads: SourceAdapter = {
  id: "workingnomads",
  label: "Working Nomads",
  countries: "*",
  categories: "*",
  workModes: ["remote"],
  rateLimit: { host: "www.workingnomads.com", minIntervalMs: 2000 },
  terms: {
    status: "public_feed",
    note: "Public JSON feed at /api/exposed_jobs. No API terms found; link back to the posting and name the source.",
  },
  async fetch(ctx) {
    const body = await ctx.http.json<NomadJob[]>("https://www.workingnomads.com/api/exposed_jobs/");
    return body ? parseWorkingNomads(body) : [];
  },
};

// ---------------------------------------------------------------------------
// Workable job search
// ---------------------------------------------------------------------------
interface WorkableSearchJob {
  title: string;
  description?: string;
  requirementsSection?: string;
  url: string;
  locations?: string[];
  location?: { city?: string; subregion?: string | null; countryName?: string };
  created?: string;
  company?: { title?: string };
  workplace?: string;
}

const WORKPLACE: Record<string, RawJob["workModeHint"]> = { remote: "remote", hybrid: "hybrid", on_site: "onsite", onsite: "onsite" };

export function parseWorkableSearch(body: { jobs?: WorkableSearchJob[] }): RawJob[] {
  return asArray(body.jobs).map((j) => ({
    url: j.url,
    applyUrl: j.url,
    source: "workable-search",
    company: j.company?.title ?? "",
    title: j.title,
    description: htmlToText(`${j.description ?? ""}\n${j.requirementsSection ?? ""}`),
    locationText: [j.location?.city, j.location?.countryName].filter(Boolean).join(", "),
    workModeHint: WORKPLACE[(j.workplace ?? "").toLowerCase()] ?? null,
    country: guessCountry(j.location?.countryName),
    postedAt: toIso(j.created),
    fromAts: true,
    atsFields: { locations: asArray(j.locations), location: j.location, workplace: j.workplace },
  }));
}

export const workableSearch: SourceAdapter = {
  id: "workable-search",
  label: "Workable job search",
  countries: "*",
  categories: "*",
  workModes: ["remote", "hybrid", "onsite"],
  rateLimit: { host: "jobs.workable.com", minIntervalMs: 3000 },
  terms: {
    status: "unverified",
    note: "Undocumented endpoint behind jobs.workable.com, whose robots.txt disallows /search. It answers Cloudflare 1015 to bursts. Off until Tony decides; the documented per-account widget in the ATS adapter stays on.",
  },
  async fetch(ctx) {
    const out: RawJob[] = [];
    for (const q of ctx.queries) {
      const body = await ctx.http.json<{ jobs?: WorkableSearchJob[] }>(
        `https://jobs.workable.com/api/v1/jobs?query=${encodeURIComponent(q)}`,
      );
      if (body) out.push(...parseWorkableSearch(body));
    }
    return out;
  },
};

// ---------------------------------------------------------------------------
// Hacker News "Who is hiring?"
// ---------------------------------------------------------------------------
interface HnItem {
  id: number;
  title?: string;
  created_at?: string;
  text?: string | null;
  children?: HnItem[];
}

const REMOTE_WORDS = /\bremote\b/i;
const ONSITE_WORDS = /\b(on-?site|in[- ]office)\b/i;
const HYBRID_WORDS = /\bhybrid\b/i;
const ROLE_WORDS = /engineer|developer|scientist|designer|analyst|manager|lead|architect|programmer|sre|devops/i;

/** Comments follow a loose "Company | Role | Location | Remote" first line. Unparseable ones are skipped. */
export function parseHnThread(item: HnItem): RawJob[] {
  return asArray(item.children).flatMap((c) => {
    if (!c.text) return [];
    const text = htmlToText(c.text);
    const first = text.split("\n")[0] ?? "";
    // Mostly "Company | Role | Place", though some posters use dashes.
    const parts = first.split(/\||\s[—–]\s/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) return [];
    const role = parts.slice(1).find((p) => ROLE_WORDS.test(p));
    if (!role) return [];
    const rest = parts.slice(1).filter((p) => p !== role);
    const url = `https://news.ycombinator.com/item?id=${c.id}`;
    const link = c.text.match(/href="([^"]+)"/)?.[1];
    return [
      {
        url,
        applyUrl: link ? decodeEntities(link) : url,
        source: "hackernews",
        company: parts[0]!,
        title: role,
        description: text,
        locationText: rest.join(", "),
        workModeHint: REMOTE_WORDS.test(first) ? "remote" : HYBRID_WORDS.test(first) ? "hybrid" : ONSITE_WORDS.test(first) ? "onsite" : null,
        country: guessCountry(rest.join(", ")),
        postedAt: toIso(c.created_at),
        fromAts: false,
        atsFields: { firstLine: first },
      },
    ];
  });
}

export const hackerNews: SourceAdapter = {
  id: "hackernews",
  label: 'Hacker News "Who is hiring?"',
  countries: "*",
  categories: ["software-engineering", "data-ai"],
  workModes: ["remote", "hybrid", "onsite"],
  rateLimit: { host: "hn.algolia.com", minIntervalMs: 1000 },
  terms: {
    status: "permitted",
    note: "Official HN Algolia API. Comments land in the first week of the month, so after mid-month this source is usually past the age limit.",
  },
  async fetch(ctx: FetchContext) {
    const found = await ctx.http.json<{ hits?: { objectID: string; title: string; created_at: string }[] }>(
      "https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&query=hiring",
    );
    const thread = asArray(found?.hits).find((h) => /who is hiring/i.test(h.title));
    if (!thread) return [];
    const ageDays = (ctx.now.getTime() - new Date(thread.created_at).getTime()) / 86_400_000;
    if (ageDays > 40) return [];
    const item = await ctx.http.json<HnItem>(`https://hn.algolia.com/api/v1/items/${thread.objectID}`);
    return item ? parseHnThread(item) : [];
  },
};

/** Remote Rocketship is deliberately absent: its terms prohibit scraping (remoterocketship.com/terms, section 5). */
export const AGGREGATORS: SourceAdapter[] = [
  himalayas,
  remotive,
  remoteOk,
  weWorkRemotely,
  jobicy,
  workingNomads,
  hackerNews,
  workableSearch,
];
