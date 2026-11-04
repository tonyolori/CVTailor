import "server-only";
import { DEFAULT_CV_REQUESTS_PER_DAY, hasActivePlan } from "@jobtailor/core";

export interface CvAllowance {
  /** Billing is off, so nothing is counted. Every invited user has full service. */
  unlimited: boolean;
  /** Everything they can use right now. */
  left: number;
  plan: number;
  free: number;
  extra: number;
  planActive: boolean;
}

export interface AllowanceFields {
  plan: string;
  paid_until: string | null;
  cv_plan_left: number;
  cv_free_left: number;
  cv_extra_left: number;
}

export const ALLOWANCE_COLUMNS = "plan,paid_until,cv_plan_left,cv_free_left,cv_extra_left";

export function billingEnforced(): boolean {
  return process.env.BILLING_ENFORCED === "true";
}

/** The same order the database spends them in. Plan CVs stop counting once the plan runs out. */
export function cvAllowance(profile: AllowanceFields, now = new Date()): CvAllowance {
  const planActive = hasActivePlan({ plan: profile.plan, paidUntil: profile.paid_until }, now);
  const plan = planActive ? profile.cv_plan_left : 0;
  return {
    unlimited: !billingEnforced(),
    left: plan + profile.cv_free_left + profile.cv_extra_left,
    plan,
    free: profile.cv_free_left,
    extra: profile.cv_extra_left,
    planActive,
  };
}

export function cvRequestsPerDay(): number {
  const n = Number(process.env.CV_REQUESTS_PER_DAY);
  return process.env.CV_REQUESTS_PER_DAY && Number.isInteger(n) && n >= 0 ? n : DEFAULT_CV_REQUESTS_PER_DAY;
}
