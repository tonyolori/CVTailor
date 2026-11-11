import { describe, expect, it } from "vitest";
import { hashToken, newToken, notifyChange, type NotifyState } from "./notify-email";

const base: NotifyState = { email: "me@example.com", notify_email: null, notify_email_pending: null, notify_email_sent_at: null };
const now = new Date("2026-11-11T10:00:00Z");

describe("notifyChange", () => {
  it("needs no confirmation for the sign-in address or an empty box", () => {
    expect(notifyChange(base, "", now)).toEqual({ kind: "use_sign_in" });
    expect(notifyChange(base, " ME@example.com ", now)).toEqual({ kind: "use_sign_in" });
  });

  it("asks a new address to confirm", () => {
    expect(notifyChange(base, "Work@Example.com", now)).toEqual({ kind: "confirm", to: "work@example.com" });
  });

  it("leaves a confirmed address alone", () => {
    expect(notifyChange({ ...base, notify_email: "work@example.com" }, "work@example.com", now)).toEqual({ kind: "unchanged" });
  });

  it("doesn't send a second link straight after the first", () => {
    const waiting = { ...base, notify_email_pending: "work@example.com", notify_email_sent_at: "2026-11-11T09:55:00Z" };
    expect(notifyChange(waiting, "work@example.com", now)).toEqual({ kind: "already_sent", to: "work@example.com" });
    expect(notifyChange({ ...waiting, notify_email_sent_at: "2026-11-11T09:00:00Z" }, "work@example.com", now)).toEqual({ kind: "confirm", to: "work@example.com" });
  });
});

describe("tokens", () => {
  it("stores a hash that differs from the token and matches it again", () => {
    const { token, hash } = newToken();
    expect(hash).not.toContain(token);
    expect(hashToken(token)).toBe(hash);
  });
});
