import type { WorkMode } from "@cvtailor/core";
import type { Http } from "./http";

/** The common shape every adapter returns. */
export interface RawJob {
  /** The posting's own URL. Unique key in `jobs`. */
  url: string;
  /** The link for the Apply button. Some sources require this to stay on their site, unchanged. */
  applyUrl: string;
  source: string;
  company: string;
  title: string;
  /** Plain text. Untrusted. */
  description: string;
  /** The source's own location words, as given. */
  locationText: string;
  workModeHint: WorkMode | null;
  /** ISO 3166-1 alpha-2 hint for pre-filtering. */
  country: string | null;
  postedAt: string | null;
  fromAts: boolean;
  /** Structured location and date fields, passed to enrichment whole. */
  atsFields: Record<string, unknown>;
}

export type TermsStatus =
  /** Published API or feed whose terms permit this use, under the stated conditions. */
  | "permitted"
  /** Public feed or endpoint intended for reuse, with no terms found either way. */
  | "public_feed"
  /** Works, but its terms don't clearly allow this. Off unless Tony enables it. */
  | "unverified";

export interface Terms {
  status: TermsStatus;
  /** Conditions to honour, and where they came from. */
  note: string;
  /** The free tier doesn't allow paid products. Disabled once billing is on. */
  blockedWhenPaid?: boolean;
}

export interface FetchContext {
  http: Http;
  /** Titles and search topics of active users, de-duplicated and capped, most important first. */
  queries: string[];
  /** Where active users live (ISO alpha-2), for sources that can search roles open to one country. */
  countries: string[];
  now: Date;
}

export interface SourceAdapter {
  id: string;
  /** Credited to the user where a source requires it. */
  label: string;
  /** Countries served, or "*" for anywhere. */
  countries: string[] | "*";
  /** Category ids served, or "*" for all. */
  categories: string[] | "*";
  workModes: WorkMode[];
  /** Minimum gap between requests to this source's host. */
  rateLimit: { host: string; minIntervalMs: number };
  terms: Terms;
  /** Searches by query rather than returning one fixed feed. Only these run in the fallback-title search. */
  queryDriven?: boolean;
  fetch(ctx: FetchContext): Promise<RawJob[]>;
}
