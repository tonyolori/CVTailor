import { describe, expect, it } from "vitest";
import { PreferencesSchema, onsiteNursePersona, prefilter, remoteAccountantPersona, remoteSoftwarePersona } from "./index";

const NOW = new Date("2026-11-02T00:00:00Z");
const categories = [
  { id: "software-engineering", keywords: ["software", "backend", "developer"] },
  { id: "accounting-finance", keywords: ["accountant", "accounting"] },
  { id: "nursing-healthcare", keywords: ["nurse", "nursing"] },
];
const users = [remoteSoftwarePersona.preferences, remoteAccountantPersona.preferences, onsiteNursePersona.preferences];
const job = (title: string, over: Partial<Parameters<typeof prefilter>[0]> = {}) => ({
  title,
  locationText: "Remote",
  workModeHint: "remote" as const,
  postedAt: "2026-10-30",
  ...over,
});

describe("prefilter", () => {
  it("keeps a title that any active user wants, in any profession", () => {
    expect(prefilter(job("Backend Engineer"), users, categories, NOW).keep).toBe(true);
    expect(prefilter(job("Senior Accountant"), users, categories, NOW).keep).toBe(true);
    expect(prefilter(job("Staff Nurse", { locationText: "Manchester", workModeHint: "onsite" }), users, categories, NOW).keep).toBe(true);
  });

  it("drops a title nobody wants, before any LLM call", () => {
    const r = prefilter(job("Long-haul Truck Driver"), users, categories, NOW);
    expect(r).toEqual({ keep: false, reason: "title" });
  });

  it("collection stays relevant to active users only", () => {
    expect(prefilter(job("Backend Engineer"), [onsiteNursePersona.preferences], categories, NOW).keep).toBe(false);
  });

  it("drops postings older than every user's window", () => {
    const r = prefilter(job("Backend Engineer", { postedAt: "2026-08-01" }), users, categories, NOW);
    expect(r.keep).toBe(false);
    expect(r.reason).toBe("age");
  });

  it("keeps a posting with no date, since enrichment may find one", () => {
    expect(prefilter(job("Backend Engineer", { postedAt: null }), users, categories, NOW).keep).toBe(true);
  });

  it("with near misses off, drops roles the user can't take", () => {
    const strict = PreferencesSchema.parse({ ...onsiteNursePersona.preferences, worthALookCount: 0 });
    expect(prefilter(job("Staff Nurse"), [strict], categories, NOW)).toEqual({ keep: false, reason: "place" });
    expect(
      prefilter(job("Staff Nurse", { locationText: "Leeds, UK", workModeHint: "onsite" }), [strict], categories, NOW).keep,
    ).toBe(false);
    expect(
      prefilter(job("Staff Nurse", { locationText: "Manchester, UK", workModeHint: "onsite" }), [strict], categories, NOW).keep,
    ).toBe(true);
  });

  it("matches multi-word titles without needing every word", () => {
    expect(prefilter(job("Backend Software Engineer"), [remoteSoftwarePersona.preferences], categories, NOW).keep).toBe(true);
  });

  it("doesn't match a keyword inside another word", () => {
    const only = [remoteAccountantPersona.preferences];
    expect(prefilter(job("Accounting Manager"), only, categories, NOW).keep).toBe(true);
    expect(prefilter(job("Accountability Coach"), only, categories, NOW).keep).toBe(false);
  });
});

describe("prefilter near misses", () => {
  const nurse = onsiteNursePersona.preferences;

  it("keeps another city in the user's country for a main title", () => {
    const r = prefilter(job("Staff Nurse", { locationText: "Leeds, United Kingdom", workModeHint: "onsite" }), [nurse], categories, NOW);
    expect(r.keep).toBe(true);
  });

  it("drops a physical role in another country, even for a main title", () => {
    const r = prefilter(job("Staff Nurse", { locationText: "Berlin, Germany", workModeHint: "onsite" }), [nurse], categories, NOW);
    expect(r).toEqual({ keep: false, reason: "place" });
  });

  it("drops a near miss when only an expansion title or keyword matched", () => {
    const r = prefilter(job("Nurse Educator", { locationText: "Leeds, United Kingdom", workModeHint: "onsite" }), [nurse], categories, NOW);
    expect(r.keep).toBe(false);
  });

  it("keeps a location-limited remote role for a main title: it may be worth a look", () => {
    const r = prefilter(job("Backend Engineer", { locationText: "Remote, Germany" }), [remoteSoftwarePersona.preferences], categories, NOW);
    expect(r.keep).toBe(true);
  });
});
