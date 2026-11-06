import { describe, expect, it } from "vitest";
import { FactLibrarySchema, titlesFromLibrary } from "./facts";

const lib = (entries: object[]) => FactLibrarySchema.parse({ contact: { name: "A", email: "a@example.com" }, entries });
const role = (id: string, title: string, start?: string, end?: string | null) => ({ id, kind: "role", title, org: "Org", start, end });

describe("titlesFromLibrary", () => {
  it("lists roles latest first, with the current one at the top", () => {
    const l = lib([role("1", "Staff Nurse", "2015-01", "2018-06"), role("2", "Ward Manager", "2021-03", null), role("3", "Charge Nurse", "2018-07", "2021-02")]);
    expect(titlesFromLibrary(l)).toEqual(["Ward Manager", "Charge Nurse", "Staff Nurse"]);
  });

  it("skips non-roles and repeats, and stops at the limit", () => {
    const l = lib([
      role("1", "Accountant", "2020-01", "2021-01"),
      role("2", "accountant", "2019-01", "2019-12"),
      { id: "3", kind: "education", title: "BSc Accounting", org: "Uni" },
      role("4", "Auditor", "2017-01", "2018-12"),
      role("5", "Clerk", "2015-01", "2016-12"),
    ]);
    expect(titlesFromLibrary(l, 2)).toEqual(["Accountant", "Auditor"]);
  });

  it("is empty for a library with no roles", () => {
    expect(titlesFromLibrary(lib([]))).toEqual([]);
  });
});
