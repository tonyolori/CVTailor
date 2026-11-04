import "server-only";
import { DEFAULT_CV_REQUESTS_PER_DAY, isEntitled } from "@jobtailor/core";

/** The same decision the worker makes. With billing off, every invited user has full service. */
export function hasPaidFeatures(profile: { plan: string; paid_until: string | null }, now = new Date()): boolean {
  return isEntitled({ plan: profile.plan, paidUntil: profile.paid_until }, process.env.BILLING_ENFORCED === "true", now);
}

export function cvRequestsPerDay(): number {
  const n = Number(process.env.CV_REQUESTS_PER_DAY);
  return process.env.CV_REQUESTS_PER_DAY && Number.isInteger(n) && n >= 0 ? n : DEFAULT_CV_REQUESTS_PER_DAY;
}
