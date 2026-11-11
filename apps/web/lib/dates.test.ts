import { describe, expect, it } from "vitest";
import { dateInWords, exactDate } from "./dates";

const now = new Date("2026-11-11T09:30:00Z");

describe("dateInWords", () => {
  it("says today and yesterday for calendar days", () => {
    expect(dateInWords("2026-11-11", now)).toBe("Today");
    expect(dateInWords("2026-11-10", now)).toBe("Yesterday");
  });

  it("counts days for the last week, then names the date", () => {
    expect(dateInWords("2026-11-08", now)).toBe("3 days ago");
    expect(dateInWords("2026-11-01", now)).toBe("1 November");
    expect(dateInWords("2025-11-01", now)).toBe("1 November 2025");
  });

  it("adds the time to moments from today or yesterday", () => {
    expect(dateInWords("2026-11-11T08:05:00Z", now, "UTC")).toBe("Today, 08:05");
    expect(dateInWords("2026-11-10T23:50:00Z", now, "UTC")).toBe("Yesterday, 23:50");
  });

  it("counts days in the reader's time zone", () => {
    // 23:30 UTC on the 10th is already the 11th in Lagos.
    expect(dateInWords("2026-11-10T23:30:00Z", now, "Africa/Lagos")).toBe("Today, 00:30");
  });

  it("doesn't throw on rubbish", () => {
    expect(dateInWords("not a date", now)).toBe("Unknown");
    expect(exactDate("not a date")).toBe("");
  });
});

describe("exactDate", () => {
  it("spells out the whole date", () => {
    expect(exactDate("2026-11-10")).toBe("Tuesday, 10 November 2026");
    expect(exactDate("2026-11-10T08:05:00Z", "UTC")).toContain("10 November 2026");
  });
});
