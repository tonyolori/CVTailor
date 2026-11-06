import { describe, expect, it } from "vitest";
import { bodyErrorCode, safeLogFields } from "./log";

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

describe("bodyErrorCode", () => {
  it("reads the code each service names differently", () => {
    expect(bodyErrorCode({ code: "42501", message: "permission denied for table profiles" })).toBe("42501");
    expect(bodyErrorCode({ error_code: "otp_expired" })).toBe("otp_expired");
  });

  it("names the Supabase gateway's key errors, which come without a code", () => {
    expect(bodyErrorCode({ message: "Invalid API key", hint: "Double check your Supabase `anon` or `service_role` API key." })).toBe("invalid_api_key");
    expect(bodyErrorCode({ message: "No API key found in request" })).toBe("no_api_key");
  });

  it("never turns another message into a code, since it could be free text", () => {
    expect(bodyErrorCode({ message: "Could not parse Ada Obi's CV" })).toBeUndefined();
  });
});
