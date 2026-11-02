import { describe, expect, it } from "vitest";
import {
  EnrichedJobSchema,
  FactLibrarySchema,
  PreferencesSchema,
  ResumeSchema,
  evaluateGates,
  numbersIn,
  verifyResume,
} from "./index";

const NOW = new Date("2026-11-02T00:00:00Z");

const prefs = PreferencesSchema.parse({
  targetTitles: ["AI Engineer"],
  eligibility: { country: "NG", regions: ["AFRICA", "EMEA"], utcOffsetHours: 1 },
  companyBase: ["europe", "north_america"],
});

const job = (over: Record<string, unknown> = {}, title = "AI Engineer") => ({
  title,
  enriched: EnrichedJobSchema.parse({
    isOpen: true,
    postedAt: "2026-10-28",
    remoteType: "remote",
    worldwide: true,
    companyHq: "europe",
    roleFamily: "ai_engineer",
    seniority: "mid",
    maxYearsRequired: 3,
    ...over,
  }),
});

describe("evaluateGates", () => {
  it("passes a worldwide remote role", () => {
    expect(evaluateGates(job(), prefs, NOW).pass).toBe(true);
  });

  it("a country list that omits the candidate beats a worldwide label", () => {
    const r = evaluateGates(job({ worldwide: true, eligibleCountries: ["DE", "FR"] }), prefs, NOW);
    expect(r.pass).toBe(false);
    expect(r.locationOnly).toBe(true);
  });

  it("EMEA passes unless work authorisation elsewhere is required", () => {
    expect(evaluateGates(job({ worldwide: false, eligibleRegions: ["EMEA"] }), prefs, NOW).pass).toBe(true);
    const r = evaluateGates(
      job({ worldwide: false, eligibleRegions: ["EMEA"], requiresWorkAuthorization: ["GB"] }),
      prefs,
      NOW,
    );
    expect(r.pass).toBe(false);
  });

  it("plain remote with no location info is unclear and fails on location only", () => {
    const r = evaluateGates(job({ worldwide: false }), prefs, NOW);
    expect(r.failed).toEqual(["location"]);
    expect(r.locationOnly).toBe(true);
  });

  it("rejects old postings, senior titles and long experience asks", () => {
    expect(evaluateGates(job({ postedAt: "2026-09-01" }), prefs, NOW).failed).toContain("age");
    expect(evaluateGates(job({}, "Staff AI Engineer"), prefs, NOW).failed).toContain("exclusion");
    expect(evaluateGates(job({ maxYearsRequired: 8 }), prefs, NOW).failed).toContain("seniority");
  });

  it("rejects time-zone windows that exclude UTC+1", () => {
    const r = evaluateGates(job({ tzRestriction: { minUtcOffset: -8, maxUtcOffset: -5 } }), prefs, NOW);
    expect(r.failed).toContain("timezone");
  });
});

const lib = FactLibrarySchema.parse({
  contact: { name: "Test User", email: "t@example.com" },
  skills: ["TypeScript"],
  entries: [
    {
      id: "e1",
      kind: "role",
      title: "Backend Developer",
      org: "Acme Bank",
      start: "2024-03",
      end: null,
      facts: [
        { id: "f1", text: "Built 6 products across 10 services, about 70,000 lines of C#" },
        { id: "f2", text: "Architecture sized for 5 million events per day", designCapacity: true },
      ],
      doNotClaim: ["20+ services"],
      tags: ["C#", "PostgreSQL"],
    },
  ],
});

const baseResume = () =>
  ResumeSchema.parse({
    header: { name: "Test User", roleTitle: "Backend Engineer", email: "t@example.com" },
    summary: "Backend engineer with C# experience.",
    skills: [{ group: "Languages", items: ["C#", "Postgres"] }],
    experience: [
      {
        title: "Backend Developer",
        company: "Acme Bank",
        start: "2024-03",
        end: null,
        bullets: ["Delivered 6 products across 10 services, about 70k lines of C#."],
      },
    ],
    education: [{ degree: "BSc", school: "Uni", start: "2019", end: "2023" }],
  });

describe("numbersIn", () => {
  it("expands k and m suffixes and ignores digits inside words", () => {
    expect(numbersIn("70k lines, 5 million, OAuth2, C#12")).toEqual([70000, 5_000_000]);
  });
});

describe("verifyResume", () => {
  it("accepts a resume built from the library", () => {
    const r = verifyResume(baseResume(), lib);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("flags invented numbers, skills and forbidden claims", () => {
    const r = baseResume();
    r.experience[0]!.bullets.push("Led 25 engineers across 20+ services.");
    r.skills[0]!.items.push("Rust");
    const v = verifyResume(r, lib);
    expect(v.ok).toBe(false);
    const msgs = v.issues.map((i) => i.message).join("\n");
    expect(msgs).toContain("Number 25");
    expect(msgs).toContain("20+ services");
    expect(msgs).toContain("Rust");
  });

  it("flags design-capacity figures phrased as measured", () => {
    const r = baseResume();
    r.experience[0]!.bullets.push("Processed 5 million events per day.");
    const v = verifyResume(r, lib);
    expect(v.issues.some((i) => i.message.includes("built for"))).toBe(true);
  });
});
