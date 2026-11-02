import { parseAshby, parseBreezy, parseGreenhouse, parseLever, type CompanyRow } from "../sources/ats";
import type { Http } from "../sources/http";
import { htmlToText, toIso } from "../sources/text";
import type { RawJob } from "../sources/types";

export interface LiveCheck {
  reachable: boolean;
  closedSignal: string | null;
  /** The JobPosting JSON-LD block, narrowed to the fields that matter. */
  jsonLd: Record<string, unknown> | null;
  /** Date from the page's own data. Beats an aggregator's repost date. */
  postedAt: string | null;
  /** Page text, when the source gave no description. */
  text: string | null;
  /** The employer's own API record, when the link leads to a supported ATS. */
  record?: RawJob | null;
}

const CLOSED_PATTERNS = [
  /no longer (?:accepting|available|open|active)/i,
  /this (?:job|position|role|posting|vacancy) (?:has been|is|was) (?:closed|filled|removed|expired)/i,
  /position (?:has been )?filled/i,
  /job not found/i,
  /applications? (?:are |is )?(?:now )?closed/i,
];

const JSON_LD_FIELDS = [
  "title",
  "datePosted",
  "validThrough",
  "employmentType",
  "jobLocationType",
  "jobLocation",
  "applicantLocationRequirements",
  "hiringOrganization",
  "baseSalary",
];

export function extractJsonLd(html: string): Record<string, unknown> | null {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(m[1]!);
      const items = Array.isArray(parsed) ? parsed : parsed["@graph"] ?? [parsed];
      const posting = (items as Record<string, unknown>[]).find((i) => i?.["@type"] === "JobPosting");
      if (posting) {
        return Object.fromEntries(JSON_LD_FIELDS.filter((k) => posting[k] !== undefined).map((k) => [k, posting[k]]));
      }
    } catch {
      // Malformed blocks are common. Try the next.
    }
  }
  return null;
}

/** Reads a posting's live page: open or closed, structured location fields, JSON-LD date. */
export function interpretLivePage(html: string | null): LiveCheck {
  if (html == null) return { reachable: false, closedSignal: null, jsonLd: null, postedAt: null, text: null };
  const jsonLd = extractJsonLd(html);
  const text = htmlToText(html);
  const closed = CLOSED_PATTERNS.map((p) => text.match(p)?.[0]).find(Boolean) ?? null;
  const valid = jsonLd?.validThrough ? new Date(String(jsonLd.validThrough)) : null;
  const expired = valid && !Number.isNaN(valid.getTime()) && valid.getTime() < Date.now() ? "validThrough has passed" : null;
  return {
    reachable: true,
    closedSignal: closed ?? expired,
    jsonLd,
    postedAt: jsonLd?.datePosted ? toIso(String(jsonLd.datePosted)) : null,
    text,
  };
}

function companyFor(ats: string, slug: string): CompanyRow {
  return { id: 0, ats, slug, tags: [], countries: [], fail_count: 0 };
}

/**
 * The real record from the employer's ATS, when a URL leads to one that has an API. Its
 * structured location fields and date are what the location rule depends on.
 */
export async function resolveAtsRecord(http: Http, url: string): Promise<RawJob | null> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const parts = u.pathname.split("/").filter(Boolean);
  if (u.host === "jobs.ashbyhq.com" && parts.length >= 2) {
    const body = await http.json<never>(`https://api.ashbyhq.com/posting-api/job-board/${parts[0]}`);
    if (!body) return null;
    return parseAshby(body, companyFor("ashby", parts[0]!)).find((j) => j.url.includes(parts[1]!)) ?? null;
  }
  if (/(^|\.)greenhouse\.io$/.test(u.host) && parts.includes("jobs")) {
    const slug = parts[0]!;
    const id = parts[parts.indexOf("jobs") + 1];
    if (!id) return null;
    // EU boards are served from the main API host too.
    const body = await http.json<never>(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${id}?content=true`);
    return body ? (parseGreenhouse({ jobs: [body] }, companyFor("gh", slug))[0] ?? null) : null;
  }
  if (u.host.endsWith(".breezy.hr") && parts[0] === "p" && parts[1]) {
    // The board's own list holds every location, where the page's JSON-LD has only the first.
    const slug = u.host.replace(".breezy.hr", "");
    const body = await http.json<never[]>(`https://${slug}.breezy.hr/json`);
    if (!Array.isArray(body)) return null;
    const found = parseBreezy(body, companyFor("breezy", slug)).find((j) => j.url.includes(parts[1]!));
    if (!found) return null;
    const page = await http.text(url);
    return { ...found, description: page ? htmlToText(page) : "" };
  }
  if (u.host === "jobs.lever.co" && parts.length >= 2) {
    const body = await http.json<never>(`https://api.lever.co/v0/postings/${parts[0]}/${parts[1]}?mode=json`);
    if (body) return parseLever([body], companyFor("lever", parts[0]!))[0] ?? null;
    return null;
  }
  return null;
}

export async function checkLive(http: Http, url: string): Promise<LiveCheck> {
  const record = await resolveAtsRecord(http, url);
  if (record) {
    return { reachable: true, closedSignal: null, jsonLd: null, postedAt: record.postedAt, text: record.description, record };
  }
  return interpretLivePage(await http.text(url));
}
