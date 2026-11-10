import { describe, expect, it } from "vitest";
import { ResumeSchema } from "@cvtailor/core";
import { landingExample } from "./landing-examples";
import { inStage, safeHref, sourceLabel, stageKey, stageOf } from "./views";

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

describe("job stages", () => {
  const m = (decision: string, tracker_status = "to_apply") => ({ decision, tracker_status });

  it("every kind of match starts in To apply", () => {
    for (const d of ["picked", "worth-a-look", "unscored", "pasted"]) expect(inStage("to_apply", m(d))).toBe(true);
  });

  it("a close match someone applied to counts as an application", () => {
    expect(inStage("applied", m("worth-a-look", "applied"))).toBe(true);
    expect(inStage("to_apply", m("worth-a-look", "applied"))).toBe(false);
  });

  it("rejected and not-for-me both close a job", () => {
    expect(stageOf("rejected")).toBe("closed");
    expect(stageOf("dismissed")).toBe("closed");
    expect(inStage("closed", m("picked", "dismissed"))).toBe(true);
  });

  it("hides decisions nobody sees", () => {
    expect(inStage("to_apply", m("rejected-by-filter"))).toBe(false);
  });

  it("keeps old links working", () => {
    expect(stageKey("look")).toBe("to_apply");
    expect(stageKey("pasted")).toBe("to_apply");
    expect(stageKey("dismissed")).toBe("closed");
    expect(stageKey("interview")).toBe("interview");
    expect(stageKey("nonsense")).toBeNull();
    expect(stageKey(undefined)).toBeNull();
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
  const jobs = landingExample();

  it("are valid CVs", () => {
    for (const j of jobs) expect(ResumeSchema.safeParse(j.resume).success).toBe(true);
  });

  it("show the same person rewritten for each job, using only that person's facts", () => {
    expect(new Set(jobs.map((j) => j.resume.header.name)).size).toBe(1);
    expect(new Set(jobs.map((j) => j.resume.experience[0]!.bullets.join())).size).toBe(jobs.length);
  });

  it("describe each posting", () => {
    for (const j of jobs) {
      expect(j.about.length).toBeGreaterThan(0);
      expect(j.doing.length).toBeGreaterThanOrEqual(3);
      expect(j.needs.length).toBeGreaterThanOrEqual(3);
    }
  });
});
