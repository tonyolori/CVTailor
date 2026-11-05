import { describe, expect, it } from "vitest";
import { safeLogFields } from "./log";

describe("safeLogFields", () => {
  it("keeps ids and counts", () => {
    expect(safeLogFields({ userId: "abc", attachments: 2, sent: true })).toEqual({ userId: "abc", attachments: 2, sent: true });
  });

  it("refuses a field that may hold personal text", () => {
    expect(() => safeLogFields({ email: "a@b.co" })).toThrow(/personal text/);
    expect(() => safeLogFields({ name: "Ada" })).toThrow(/personal text/);
  });

  it("removes an address that turns up inside an allowed field", () => {
    expect(safeLogFields({ reason: "no user a.person+x@mail.example.com found" })).toEqual({ reason: "no user [email] found" });
  });

  it("cuts long strings", () => {
    expect((safeLogFields({ reason: "x".repeat(500) }).reason as string).length).toBeLessThanOrEqual(121);
  });
});
