import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { actionFor, checkoutBody, eventKey, metadataOf, parseEvent, verifySignature } from "./paystack";

const SECRET = "sk_test_not_a_real_key";
const sign = (body: string) => createHmac("sha512", SECRET).update(body).digest("hex");

describe("verifySignature", () => {
  const body = JSON.stringify({ event: "charge.success", data: { reference: "r1" } });

  it("accepts the correct HMAC", () => {
    expect(verifySignature(body, sign(body), SECRET)).toBe(true);
  });

  it("rejects a wrong, missing or differently sized signature", () => {
    expect(verifySignature(body, sign(body).replace(/^./, "0"), SECRET)).toBe(sign(body)[0] === "0");
    expect(verifySignature(body, null, SECRET)).toBe(false);
    expect(verifySignature(body, "short", SECRET)).toBe(false);
    expect(verifySignature(`${body} `, sign(body), SECRET)).toBe(false);
  });

  it("rejects everything if the secret isn't configured", () => {
    expect(verifySignature(body, sign(body), "")).toBe(false);
  });
});

const charge = (over = {}) =>
  parseEvent(
    JSON.stringify({
      event: "charge.success",
      data: {
        reference: "ref_1",
        status: "success",
        amount: 500000,
        currency: "NGN",
        paid_at: "2026-11-02T10:00:00.000Z",
        customer: { email: "a@example.com" },
        metadata: { user_id: "u1", plan_id: "once30" },
        ...over,
      },
    }),
  )!;

describe("actionFor", () => {
  it("a successful charge becomes a payment with the plan's days", () => {
    expect(actionFor(charge())).toEqual({
      kind: "payment",
      reference: "ref_1",
      amountKobo: 500000,
      currency: "NGN",
      userId: "u1",
      email: "a@example.com",
      planId: "once30",
      days: 30,
      subscriptionCode: undefined,
    });
  });

  it("ignores a charge that didn't succeed", () => {
    expect(actionFor(charge({ status: "failed" })).kind).toBe("ignore");
  });

  it("renewals carry no metadata: they fall back to the monthly plan and the email", () => {
    const a = actionFor(charge({ metadata: "" }));
    expect(a.kind === "payment" && a.days).toBe(31);
    expect(a.kind === "payment" && a.email).toBe("a@example.com");
    expect(a.kind === "payment" && a.userId).toBeUndefined();
  });

  it("maps subscription events to a status", () => {
    const e = (event: string) => parseEvent(JSON.stringify({ event, data: { subscription_code: "SUB_1", customer: { email: "a@example.com" } } }))!;
    expect(actionFor(e("subscription.create"))).toMatchObject({ kind: "subscription_status", status: "active", code: "SUB_1" });
    expect(actionFor(e("subscription.not_renew"))).toMatchObject({ status: "not_renewing" });
    expect(actionFor(e("subscription.disable"))).toMatchObject({ status: "disabled" });
    expect(actionFor(e("transfer.success")).kind).toBe("ignore");
  });

  it("a failed renewal marks the subscription", () => {
    const e = parseEvent(JSON.stringify({ event: "invoice.payment_failed", data: { subscription: { subscription_code: "SUB_1" } } }))!;
    expect(actionFor(e)).toMatchObject({ status: "payment_failed", code: "SUB_1" });
  });
});

describe("eventKey", () => {
  it("is the same for a retried delivery and different for a new renewal", () => {
    expect(eventKey(charge())).toBe(eventKey(charge()));
    expect(eventKey(charge())).not.toBe(eventKey(charge({ reference: "ref_2" })));
  });
});

describe("helpers", () => {
  it("reads metadata sent as a JSON string", () => {
    expect(metadataOf(charge({ metadata: JSON.stringify({ user_id: "u9" }) })).userId).toBe("u9");
    expect(metadataOf(charge({ metadata: "not json" }))).toEqual({});
  });

  it("parseEvent rejects bad payloads", () => {
    expect(parseEvent("not json")).toBeNull();
    expect(parseEvent('{"nope":1}')).toBeNull();
  });

  it("checkout limits a subscription to cards, and lets a one-off use any channel", () => {
    const base = { email: "a@example.com", userId: "u", amountKobo: 100, callbackUrl: "https://x" };
    const sub = checkoutBody({ ...base, planId: "monthly", planCode: "PLN_1" });
    expect(sub.plan).toBe("PLN_1");
    expect(sub.channels).toEqual(["card"]);
    const once = checkoutBody({ ...base, planId: "once30" });
    expect(once.plan).toBeUndefined();
    expect(once.channels).toBeUndefined();
    expect(once.metadata).toEqual({ user_id: "u", plan_id: "once30" });
  });
});
