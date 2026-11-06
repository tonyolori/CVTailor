import type { WorkMode } from "@cvtailor/core";
import type { Http } from "./http";
import { guessCountry, htmlToText, toIso } from "./text";
import type { RawJob, SourceAdapter } from "./types";

export const ATS_KINDS = ["gh", "lever", "ashby", "workable", "breezy", "recruitee"] as const;
export type AtsKind = (typeof ATS_KINDS)[number];

export interface CompanyRow {
  id: number;
  ats: string;
  slug: string;
  name?: string | null;
  tags: string[];
  countries: string[];
  fail_count: number;
}

const asArray = <T>(v: T[] | null | undefined): T[] => (Array.isArray(v) ? v : []);

const MODE: Record<string, WorkMode> = { remote: "remote", hybrid: "hybrid", onsite: "onsite", "on-site": "onsite", on_site: "onsite", inperson: "onsite" };
function modeOf(v: unknown): WorkMode | null {
  return typeof v === "string" ? (MODE[v.toLowerCase().replace(/\s+/g, "")] ?? null) : null;
}

function remoteFromText(text: string): WorkMode | null {
  if (/\bhybrid\b/i.test(text)) return "hybrid";
  return /\b(remote|anywhere|worldwide|global)\b/i.test(text) ? "remote" : null;
}

function base(company: CompanyRow, source: string) {
  return { source, company: company.name ?? company.slug, fromAts: true };
}

// ---------------------------------------------------------------------------
interface GreenhouseJob {
  absolute_url: string;
  title: string;
  company_name?: string;
  location?: { name?: string };
  first_published?: string;
  updated_at?: string;
  content?: string;
  offices?: { name?: string; location?: string }[];
}

export function parseGreenhouse(body: { jobs?: GreenhouseJob[] }, company: CompanyRow): RawJob[] {
  return asArray(body.jobs).map((j) => {
    const loc = j.location?.name ?? "";
    return {
      ...base(company, "greenhouse"),
      company: j.company_name ?? company.name ?? company.slug,
      url: j.absolute_url,
      applyUrl: j.absolute_url,
      title: j.title,
      description: htmlToText(j.content),
      locationText: loc,
      workModeHint: remoteFromText(loc),
      country: guessCountry(loc),
      // Many boards repost evergreen roles: first_published is the real posting date.
      postedAt: toIso(j.first_published ?? j.updated_at),
      atsFields: { location: loc, offices: asArray(j.offices).map((o) => o.location ?? o.name), first_published: j.first_published },
    };
  });
}

// ---------------------------------------------------------------------------
interface LeverJob {
  text: string;
  hostedUrl: string;
  applyUrl?: string;
  createdAt?: number;
  country?: string;
  workplaceType?: string;
  categories?: { location?: string; allLocations?: string[]; team?: string; department?: string };
  descriptionPlain?: string;
  descriptionBodyPlain?: string;
  additionalPlain?: string;
  lists?: { text?: string; content?: string }[];
}

export function parseLever(body: LeverJob[], company: CompanyRow): RawJob[] {
  return asArray(body).map((j) => {
    const lists = asArray(j.lists)
      .map((l) => `${l.text ?? ""}\n${htmlToText(l.content)}`)
      .join("\n");
    const loc = j.categories?.location ?? "";
    return {
      ...base(company, "lever"),
      url: j.hostedUrl,
      applyUrl: j.applyUrl ?? j.hostedUrl,
      title: j.text,
      description: [j.descriptionPlain ?? j.descriptionBodyPlain, lists, j.additionalPlain].filter(Boolean).join("\n\n"),
      locationText: [loc, j.workplaceType].filter(Boolean).join(", "),
      workModeHint: modeOf(j.workplaceType) ?? remoteFromText(loc),
      country: j.country?.toUpperCase() ?? guessCountry(loc),
      postedAt: toIso(j.createdAt),
      atsFields: { location: loc, allLocations: asArray(j.categories?.allLocations), workplaceType: j.workplaceType, country: j.country },
    };
  });
}

// ---------------------------------------------------------------------------
interface AshbyJob {
  title: string;
  jobUrl: string;
  applyUrl?: string;
  location?: string;
  secondaryLocations?: { location?: string; address?: unknown }[];
  publishedAt?: string;
  isListed?: boolean;
  isRemote?: boolean | null;
  workplaceType?: string | null;
  address?: unknown;
  descriptionPlain?: string;
}

export function parseAshby(body: { jobs?: AshbyJob[] }, company: CompanyRow): RawJob[] {
  return asArray(body.jobs)
    .filter((j) => j.isListed !== false)
    .map((j) => {
      const secondary = asArray(j.secondaryLocations).map((s) => s.location).filter(Boolean) as string[];
      const loc = j.location ?? "";
      return {
        ...base(company, "ashby"),
        url: j.jobUrl,
        applyUrl: j.applyUrl ?? j.jobUrl,
        title: j.title,
        description: j.descriptionPlain ?? "",
        locationText: [loc, ...secondary].join("; "),
        workModeHint: modeOf(j.workplaceType) ?? (j.isRemote ? "remote" : remoteFromText(loc)),
        country: secondary.length === 0 ? guessCountry(loc) : null,
        postedAt: toIso(j.publishedAt),
        // Location is `location` plus `secondaryLocations` and `address`: the list decides, not the words.
        atsFields: { location: loc, secondaryLocations: secondary, address: j.address, workplaceType: j.workplaceType, isRemote: j.isRemote },
      };
    });
}

// ---------------------------------------------------------------------------
interface WorkableJob {
  title: string;
  url: string;
  application_url?: string;
  telecommuting?: boolean;
  published_on?: string;
  created_at?: string;
  country?: string;
  city?: string;
  state?: string;
  locations?: { country?: string; countryCode?: string; city?: string; region?: string }[];
  description?: string;
}

export function parseWorkable(body: { name?: string; jobs?: WorkableJob[] }, company: CompanyRow): RawJob[] {
  return asArray(body.jobs).map((j) => {
    const locs = asArray(j.locations);
    const loc = [j.city, j.state, j.country].filter(Boolean).join(", ");
    return {
      ...base(company, "workable"),
      company: body.name ?? company.name ?? company.slug,
      url: j.url,
      applyUrl: j.application_url ?? j.url,
      title: j.title,
      description: htmlToText(j.description),
      locationText: j.telecommuting ? `Remote, ${loc}` : loc,
      workModeHint: j.telecommuting ? "remote" : null,
      country: locs[0]?.countryCode ?? guessCountry(j.country),
      postedAt: toIso(j.published_on ?? j.created_at),
      atsFields: { telecommuting: j.telecommuting, locations: locs },
    };
  });
}

// ---------------------------------------------------------------------------
interface BreezyLocation {
  country?: { id?: string; name?: string };
  city?: string;
  is_remote?: boolean;
  remote_details?: { value?: string; label?: string };
  name?: string;
}

interface BreezyJob {
  name: string;
  url: string;
  published_date?: string;
  location?: BreezyLocation;
  locations?: BreezyLocation[];
  company?: { name?: string };
  salary?: string;
}

export function parseBreezy(body: BreezyJob[], company: CompanyRow): RawJob[] {
  return asArray(body).map((j) => {
    const locs = j.locations?.length ? j.locations : j.location ? [j.location] : [];
    const remote = locs.some((l) => l.is_remote);
    return {
      ...base(company, "breezy"),
      company: j.company?.name ?? company.name ?? company.slug,
      url: j.url,
      applyUrl: j.url,
      title: j.name,
      description: "",
      locationText: locs.map((l) => l.name ?? l.country?.name).filter(Boolean).join("; "),
      workModeHint: remote ? "remote" : null,
      country: locs.length === 1 && (locs[0]!.country?.id ?? "").length === 2 ? locs[0]!.country!.id!.toUpperCase() : null,
      postedAt: toIso(j.published_date),
      atsFields: {
        locations: locs.map((l) => ({ country: l.country?.name, city: l.city, is_remote: l.is_remote, remote: l.remote_details?.label })),
        salary: j.salary,
      },
    };
  });
}

// ---------------------------------------------------------------------------
interface RecruiteeOffer {
  title: string;
  careers_url?: string;
  careers_apply_url?: string;
  company_name?: string;
  status?: string;
  published_at?: string;
  created_at?: string;
  location?: string;
  city?: string;
  country?: string;
  country_code?: string;
  remote?: boolean;
  hybrid?: boolean;
  on_site?: boolean;
  description?: string;
  requirements?: string;
  salary?: unknown;
  locations?: { city?: string; country?: string; name?: string }[];
}

export function parseRecruitee(body: { offers?: RecruiteeOffer[] }, company: CompanyRow): RawJob[] {
  return asArray(body.offers)
    .filter((j) => j.careers_url && (j.status == null || j.status === "published"))
    .map((j) => ({
      ...base(company, "recruitee"),
      company: j.company_name ?? company.name ?? company.slug,
      url: j.careers_url!,
      applyUrl: j.careers_apply_url ?? j.careers_url!,
      title: j.title,
      description: htmlToText(`${j.description ?? ""}\n${j.requirements ?? ""}`),
      locationText: j.location ?? [j.city, j.country].filter(Boolean).join(", "),
      workModeHint: j.remote ? "remote" : j.hybrid ? "hybrid" : j.on_site ? "onsite" : null,
      country: j.country_code?.toUpperCase() ?? guessCountry(j.country),
      postedAt: toIso(j.published_at ?? j.created_at),
      atsFields: { remote: j.remote, hybrid: j.hybrid, on_site: j.on_site, city: j.city, country: j.country, locations: asArray(j.locations), salary: j.salary },
    }));
}

// ---------------------------------------------------------------------------
/** Reads one company's board. Null means the board didn't answer, which counts toward the failure rule. */
export async function scanBoard(http: Http, company: CompanyRow): Promise<RawJob[] | null> {
  const { ats, slug } = company;
  switch (ats) {
    case "gh": {
      // EU boards are served from this host too.
      const body = await http.json<{ jobs?: GreenhouseJob[] }>(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`);
      return body ? parseGreenhouse(body, company) : null;
    }
    case "lever": {
      const body =
        (await http.json<LeverJob[]>(`https://api.lever.co/v0/postings/${slug}?mode=json`)) ??
        (await http.json<LeverJob[]>(`https://api.eu.lever.co/v0/postings/${slug}?mode=json`));
      return Array.isArray(body) ? parseLever(body, company) : null;
    }
    case "ashby": {
      const body = await http.json<{ jobs?: AshbyJob[] }>(`https://api.ashbyhq.com/posting-api/job-board/${slug}`);
      return body ? parseAshby(body, company) : null;
    }
    case "workable": {
      const body = await http.json<{ name?: string; jobs?: WorkableJob[] }>(
        `https://apply.workable.com/api/v1/widget/accounts/${slug}?details=true`,
      );
      return body ? parseWorkable(body, company) : null;
    }
    case "breezy": {
      const body = await http.json<BreezyJob[]>(`https://${slug}.breezy.hr/json`);
      return Array.isArray(body) ? parseBreezy(body, company) : null;
    }
    case "recruitee": {
      const body = await http.json<{ offers?: RecruiteeOffer[] }>(`https://${slug}.recruitee.com/api/offers/`);
      return body ? parseRecruitee(body, company) : null;
    }
    default:
      return null;
  }
}

/** Hosts with published or observed rate limits. Ashby answers 401 to bursts; Workable answers Cloudflare 1015. */
export const ATS_HOST_POLICIES: Record<string, { minIntervalMs: number }> = {
  "api.ashbyhq.com": { minIntervalMs: 1500 },
  "apply.workable.com": { minIntervalMs: 3000 },
  "boards-api.greenhouse.io": { minIntervalMs: 300 },
  "api.lever.co": { minIntervalMs: 500 },
};

export interface AtsScanResult {
  jobs: RawJob[];
  outcomes: { companyId: number; ok: boolean; found: number }[];
}

export async function scanCompanies(http: Http, companies: CompanyRow[], concurrency = 6): Promise<AtsScanResult> {
  const jobs: RawJob[] = [];
  const outcomes: AtsScanResult["outcomes"] = [];
  let next = 0;
  async function worker() {
    while (next < companies.length) {
      const company = companies[next++]!;
      const found = await scanBoard(http, company);
      outcomes.push({ companyId: company.id, ok: found !== null, found: found?.length ?? 0 });
      if (found) jobs.push(...found);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { jobs, outcomes };
}

/** Describes the board scanner for terms and coverage. Its fetch runs through scanCompanies, driven by the companies table. */
export const atsBoards: Omit<SourceAdapter, "fetch" | "rateLimit"> = {
  id: "ats-boards",
  label: "Employer job boards",
  countries: "*",
  categories: "*",
  workModes: ["remote", "hybrid", "onsite"],
  terms: {
    status: "permitted",
    note: "Greenhouse, Lever, Ashby, Workable, Breezy and Recruitee publish these board endpoints for career-site use. Pauses between requests; backoff on 401 and 429.",
  },
};
