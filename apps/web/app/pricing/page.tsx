import Link from "next/link";
import { ALLOWANCE_COLUMNS, cvAllowance, type AllowanceFields } from "@/lib/entitlement";
import { PLANS } from "@/lib/paystack";
import { cvCounts, formatNaira, priceNaira, type PricedPlan } from "@/lib/plan-settings";
import { createClient } from "@/lib/supabase/server";

function shownPrice(plan: PricedPlan): string | null {
  const price = priceNaira(plan);
  return price === null ? null : formatNaira(price);
}

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const monthly = shownPrice("monthly");
  const once = shownPrice("once30");
  const topUp = shownPrice("topup");
  const counts = cvCounts();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  let allowance = null;
  if (auth.user) {
    const { data } = await supabase.from("profiles").select(ALLOWANCE_COLUMNS).eq("id", auth.user.id).maybeSingle();
    if (data) allowance = cvAllowance(data as unknown as AllowanceFields);
  }

  return (
    <div className="public">
      <div className="public-top">
        <Link className="logo" href="/">
          CV Tailor
        </Link>
        {auth.user ? <Link href="/dashboard">Your matches</Link> : <Link href="/login">Sign in</Link>}
      </div>
      <main className="page">
        <h1>Plans</h1>
        <p className="sub">Your matches are free. You pay for the CVs, and only the ones you ask for. A CV that can't be written doesn't count. Payments are handled securely by Paystack, and we never see your card details.</p>
        {allowance && !allowance.unlimited ? <div className="notice">You have {allowance.left === 1 ? "1 CV" : `${allowance.left} CVs`} left.</div> : null}
        {error === "plan" ? <div className="notice bad">Extra CVs are for people on a plan. Choose a plan first.</div> : null}
        {error && error !== "plan" ? <div className="notice bad">Checkout isn't available right now. Please try again later.</div> : null}
        {!monthly && !once ? <div className="notice">Paid plans aren't open yet.</div> : null}
        <div className="grid2">
          <div className="card">
            <h2>Free</h2>
            <p>Daily matches by email and on your dashboard, {counts.free ? `plus ${counts.free} CVs to try it` : "no CVs included"}.</p>
          </div>
          {monthly ? (
            <form className="card" action="/api/billing/checkout" method="post">
              <h2>{PLANS.monthly.label}</h2>
              <p>
                <b>{monthly}</b> a month for {counts.plan} CVs. Unused CVs don't roll over. Renews by card until you cancel.
              </p>
              <input type="hidden" name="plan" value="monthly" />
              <button className="primary" type="submit">
                Subscribe
              </button>
            </form>
          ) : null}
          {once ? (
            <form className="card" action="/api/billing/checkout" method="post">
              <h2>{PLANS.once30.label}</h2>
              <p>
                <b>{once}</b> for {counts.plan} CVs over 30 days. Pay by card, bank transfer or USSD. It doesn't renew.
              </p>
              <input type="hidden" name="plan" value="once30" />
              <button className="primary" type="submit">
                Pay once
              </button>
            </form>
          ) : null}
        </div>
        {topUp ? (
          allowance?.planActive ? (
            <form className="card" action="/api/billing/checkout" method="post">
              <h2>{counts.topUp} extra CVs</h2>
              <p>
                <b>{topUp}</b>. These never expire, and they're used after your plan's CVs.
              </p>
              <input type="hidden" name="plan" value="topup" />
              <button className="primary" type="submit">
                Buy {counts.topUp} CVs
              </button>
            </form>
          ) : (
            <p className="muted">
              On a plan, you can add {counts.topUp} extra CVs for {topUp} whenever you need them. They never expire.
            </p>
          )
        ) : null}
        <small>
          <Link href="/">Back</Link>
        </small>
      </main>
    </div>
  );
}
