import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Paystack helpers. Pure functions, tested with test-mode payloads.
 * TODO(verify): paystack.com/docs blocks automated reading, so the event names, payload fields
 * and channel list below come from Paystack's published SDK and support material, not from
 * reading the docs directly. Confirm them against the live docs and a test-mode webhook
 * before taking real payments. See docs/SETUP.md, level 5.
 */
export const PLANS = {
  /** Card subscription that renews itself. Bank transfer can't, so that's the one-off below. */
  monthly: { id: "monthly", label: "Monthly subscription", kind: "subscription", days: 31 },
  /** A single payment for 30 days. Works with bank transfer and USSD, which can't auto-renew. */
  once30: { id: "once30", label: "30 days, one payment", kind: "once", days: 30 },
} as const;
export type PlanId = keyof typeof PLANS;

export function verifySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = Buffer.from(createHmac("sha512", secret).update(rawBody).digest("hex"));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const EventSchema = z.object({
  event: z.string(),
  data: z
    .object({
      id: z.union([z.string(), z.number()]).optional(),
      reference: z.string().optional(),
      status: z.string().optional(),
      amount: z.number().optional(),
      currency: z.string().optional(),
      paid_at: z.string().nullish(),
      next_payment_date: z.string().nullish(),
      subscription_code: z.string().optional(),
      email_token: z.string().optional(),
      customer: z.object({ email: z.string().optional() }).loose().optional(),
      metadata: z.unknown().optional(),
      plan: z.unknown().optional(),
      subscription: z.object({ subscription_code: z.string().optional(), next_payment_date: z.string().nullish() }).loose().optional(),
    })
    .loose(),
});
export type PaystackEvent = z.infer<typeof EventSchema>;

export function parseEvent(raw: string): PaystackEvent | null {
  try {
    const parsed = EventSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Paystack retries deliveries, so the key must be the same for a retry and differ across events. */
export function eventKey(e: PaystackEvent): string {
  const d = e.data;
  const id = d.reference ?? d.subscription_code ?? d.subscription?.subscription_code ?? String(d.id ?? "");
  const when = d.paid_at ?? d.next_payment_date ?? "";
  return `${e.event}:${id}:${when}`;
}

export function metadataOf(e: PaystackEvent): { userId?: string; planId?: string } {
  let meta = e.data.metadata;
  if (typeof meta === "string") {
    try {
      meta = JSON.parse(meta);
    } catch {
      return {};
    }
  }
  const m = (meta ?? {}) as { user_id?: unknown; plan_id?: unknown };
  return { userId: typeof m.user_id === "string" ? m.user_id : undefined, planId: typeof m.plan_id === "string" ? m.plan_id : undefined };
}

export type WebhookAction =
  | { kind: "payment"; reference: string; amountKobo: number; currency: string; userId?: string; email?: string; planId?: string; days: number; subscriptionCode?: string }
  | { kind: "subscription_status"; code: string; status: string; email?: string; userId?: string; emailToken?: string; nextPayment?: string | null }
  | { kind: "ignore" };

/** Turns a verified event into what should happen. Entitlement comes only from here, never a redirect. */
export function actionFor(e: PaystackEvent): WebhookAction {
  const d = e.data;
  const { userId, planId } = metadataOf(e);
  switch (e.event) {
    case "charge.success": {
      if (d.status && d.status !== "success") return { kind: "ignore" };
      if (!d.reference || d.amount == null) return { kind: "ignore" };
      const plan = planId && planId in PLANS ? PLANS[planId as PlanId] : PLANS.monthly;
      return {
        kind: "payment",
        reference: d.reference,
        amountKobo: d.amount,
        currency: d.currency ?? "NGN",
        userId,
        email: d.customer?.email,
        planId: plan.id,
        days: plan.days,
        subscriptionCode: d.subscription?.subscription_code,
      };
    }
    case "subscription.create":
    case "subscription.enable":
      return d.subscription_code
        ? { kind: "subscription_status", code: d.subscription_code, status: "active", email: d.customer?.email, userId, emailToken: d.email_token, nextPayment: d.next_payment_date }
        : { kind: "ignore" };
    case "subscription.not_renew":
      return d.subscription_code
        ? { kind: "subscription_status", code: d.subscription_code, status: "not_renewing", email: d.customer?.email, userId, nextPayment: d.next_payment_date }
        : { kind: "ignore" };
    case "subscription.disable":
      return d.subscription_code ? { kind: "subscription_status", code: d.subscription_code, status: "disabled", email: d.customer?.email, userId } : { kind: "ignore" };
    case "invoice.payment_failed": {
      const code = d.subscription?.subscription_code;
      return code ? { kind: "subscription_status", code, status: "payment_failed", email: d.customer?.email, userId } : { kind: "ignore" };
    }
    default:
      return { kind: "ignore" };
  }
}

export function checkoutBody(params: {
  email: string;
  userId: string;
  planId: PlanId;
  amountKobo: number;
  callbackUrl: string;
  planCode?: string;
}) {
  const plan = PLANS[params.planId];
  return {
    email: params.email,
    amount: params.amountKobo,
    currency: "NGN",
    callback_url: params.callbackUrl,
    metadata: { user_id: params.userId, plan_id: plan.id },
    ...(plan.kind === "subscription" && params.planCode ? { plan: params.planCode, channels: ["card"] } : {}),
  };
}
