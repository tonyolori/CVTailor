import { describe, expect, it } from "vitest";
import { experienceYears, isAboveLevel, levelDefaults, topicsFromLibrary } from "./level";
import type { FactEntry } from "./facts";

const now = new Date("2026-11-11T00:00:00Z");
const role = (over: Partial<FactEntry>): FactEntry => ({
  id: Math.random().toString(36).slice(2),
  kind: "role",
  title: "Accountant",
  org: "Org",
  facts: [],
  variants: [],
  doNotClaim: [],
  notes: [],
  tags: [],
  ...over,
});

describe("experienceYears", () => {
  it("counts overlapping roles once and skips internships", () => {
    const lib = {
      entries: [
        role({ start: "2024-03", end: null }),
        role({ start: "2025-01", end: "2025-06" }),
        role({ title: "Audit Intern", start: "2022-06", end: "2022-12" }),
      ],
    };
    expect(experienceYears(lib, now)).toBe(2.8);
  });

  it("is zero for an empty library", () => {
    expect(experienceYears({ entries: [] }, now)).toBe(0);
  });
});

describe("levelDefaults", () => {
  it("caps years a little above what the person has and excludes lead roles", () => {
    const d = levelDefaults({ entries: [role({ start: "2024-05", end: null })] }, now);
    expect(d.maxYearsRequired).toBe(5);
    expect(d.excludeSeniority).toEqual(["intern", "lead", "executive"]);
  });

  it("keeps lead roles for someone who has held one", () => {
    const d = levelDefaults({ entries: [role({ title: "Team Lead, Payroll", start: "2020-01", end: null })] }, now);
    expect(d.excludeSeniority).not.toContain("lead");
  });

  it("sets no limits without experience", () => {
    expect(levelDefaults({ entries: [] }, now)).toEqual({ years: 0, maxYearsRequired: null, excludeSeniority: [] });
  });
});

describe("isAboveLevel", () => {
  const junior = { entries: [role({ start: "2024-01", end: null })] };
  it("drops manager and lead titles for a junior person", () => {
    expect(isAboveLevel("Finance Manager", junior, [], now)).toBe(true);
    expect(isAboveLevel("Lead Accountant", junior, [], now)).toBe(true);
    expect(isAboveLevel("Senior Accountant", junior, [], now)).toBe(false);
  });
  it("never treats 'staff' as a seniority word", () => {
    expect(isAboveLevel("Staff Nurse", junior, [], now)).toBe(false);
  });
  it("keeps a title the person asked for themselves", () => {
    expect(isAboveLevel("Ward Manager", junior, ["Ward Manager"], now)).toBe(false);
  });
});

describe("topicsFromLibrary", () => {
  it("weights recent work above old work", () => {
    const lib = {
      entries: [
        role({ start: "2015-01", end: "2018-01", tags: ["Bookkeeping", "Sage"] }),
        role({ start: "2024-01", end: null, tags: ["IFRS 17", "Consolidation"] }),
      ],
      skills: ["Excel"],
    };
    expect(topicsFromLibrary(lib, 3, now)).toEqual(["Consolidation", "IFRS 17", "Bookkeeping"]);
  });
});
