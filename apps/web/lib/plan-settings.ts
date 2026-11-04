import { DEFAULT_FREE_CVS, DEFAULT_PLAN_CVS, DEFAULT_TOP_UP_CVS } from "@cvtailor/core";

type Env = Record<string, string | undefined>;

/* Prices and CV counts, all set by environment variables, so changing them needs no code change. */

function count(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

export function cvCounts(env: Env = process.env): { plan: number; topUp: number; free: number } {
  return {
    plan: count(env.CVS_PER_PLAN, DEFAULT_PLAN_CVS),
    topUp: count(env.CVS_PER_TOP_UP, DEFAULT_TOP_UP_CVS),
    free: count(env.FREE_CVS, DEFAULT_FREE_CVS),
  };
}

export type PricedPlan = "monthly" | "once30" | "topup";

const PRICE_VARIABLES: Record<PricedPlan, string> = {
  monthly: "PRICE_MONTHLY_NAIRA",
  once30: "PRICE_PASS_NAIRA",
  topup: "PRICE_TOP_UP_NAIRA",
};

/** A price in naira, or null when it isn't set, which hides that plan. "5000" and "5,000" both work. */
export function priceNaira(plan: PricedPlan, env: Env = process.env): number | null {
  const raw = env[PRICE_VARIABLES[plan]];
  if (!raw) return null;
  const n = Number(raw.replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function formatNaira(naira: number): string {
  return `₦${naira.toLocaleString("en-NG")}`;
}

/** Paystack takes amounts in kobo. This is the only place that knows it. */
export function nairaToKobo(naira: number): number {
  return Math.round(naira * 100);
}
