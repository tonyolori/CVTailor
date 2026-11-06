import { describe, expect, it } from "vitest";
import { ResumeSchema } from "@cvtailor/core";
import { landingExample } from "./landing-examples";
import { safeHref, sourceLabel, VIEWS } from "./views";

describe("safeHref", () => {
  it("keeps real web addresses", () => {
    expect(safeHref("https://example.com/job?id=1")).toBe("https://example.com/job?id=1");
  });

  it("refuses anything that could run or isn't a web page", () => {
    for (const bad of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", " javascript:alert(1)", "data:text/html,x", "pasted:abc-123", "not a url", "", null, undefined]) {
      expect(safeHref(bad)).toBeNull();
    }
  });
});

describe("sidebar views", () => {
  const m = (decision: string, tracker_status = "to_apply") => ({ decision, tracker_status });

  it("a pasted job has its own label and moves through the stages", () => {
    expect(VIEWS.pasted!.holds(m("pasted"))).toBe(true);
    expect(VIEWS.to_apply!.holds(m("pasted"))).toBe(false);
    expect(VIEWS.applied!.holds(m("pasted", "applied"))).toBe(true);
    expect(VIEWS.pasted!.holds(m("pasted", "applied"))).toBe(true);
  });

  it("close matches aren't counted as applications", () => {
    expect(VIEWS.applied!.holds(m("worth-a-look", "applied"))).toBe(false);
    expect(VIEWS.all!.holds(m("worth-a-look"))).toBe(false);
  });
});

describe("sourceLabel", () => {
  it("names sources whose terms ask for credit, and not employers' own boards", () => {
    expect(sourceLabel("remoteok")).toBe("Remote OK");
    expect(sourceLabel("greenhouse")).toBeNull();
    expect(sourceLabel("pasted")).toBeNull();
  });
});

describe("landing examples", () => {
  const people = [0, 1, 2].map((i) => landingExample(i));

  it("are valid CVs", () => {
    for (const jobs of people) for (const j of jobs) expect(ResumeSchema.safeParse(j.resume).success).toBe(true);
  });

  it("show the same person rewritten for each job, using only that person's facts", () => {
    for (const jobs of people) {
      expect(new Set(jobs.map((j) => j.resume.header.name)).size).toBe(1);
      expect(new Set(jobs.map((j) => j.resume.experience[0]!.bullets.join())).size).toBe(jobs.length);
    }
  });

  it("come from different occupations", () => {
    expect(new Set(people.map((jobs) => jobs[0]!.resume.experience[0]!.title)).size).toBe(people.length);
  });

  it("give every job a full posting from its own employer", () => {
    for (const jobs of people) {
      for (const j of jobs) {
        expect(j.company.startsWith(j.posting.employer)).toBe(true);
        expect(j.posting.about.length).toBeGreaterThan(0);
        expect(j.posting.doing.length).toBeGreaterThanOrEqual(3);
        expect(j.posting.needs.length).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
