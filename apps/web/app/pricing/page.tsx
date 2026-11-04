import Link from "next/link";
import { PLANS } from "@/lib/paystack";

function naira(kobo: string | undefined): string | null {
  const n = Number(kobo);
  return Number.isFinite(n) && n > 0 ? `₦${(n / 100).toLocaleString("en-NG")}` : null;
}

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const monthly = naira(process.env.PAYSTACK_PRICE_MONTHLY_KOBO);
  const once = naira(process.env.PAYSTACK_PRICE_ONCE_KOBO);
  return (
    <div className="public">
      <div className="public-top">
        <Link className="logo" href="/">
          JobTailor
        </Link>
      </div>
    <main className="page">
      <h1>Plans</h1>
      <p className="sub">Payments are handled securely by Paystack. We never see your card details.</p>
      {error ? <div className="notice bad">Checkout isn't available right now. Please try again later.</div> : null}
      {!monthly && !once ? <div className="notice">Paid plans aren't open yet.</div> : null}
      <div className="grid2">
        <div className="card">
          <h2>Free</h2>
          <p>A weekly digest of your matches.</p>
          <small className="muted">No tailored CVs, and no CVs on request.</small>
        </div>
        {monthly ? (
          <form className="card" action="/api/billing/checkout" method="post">
            <h2>{PLANS.monthly.label}</h2>
            <p>
              <b>{monthly}</b> a month. Daily matches and tailored CVs, plus a CV for any job you paste in. Renews by card until you cancel.
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
              <b>{once}</b> for 30 days of daily matches and tailored CVs, plus a CV for any job you paste in. Pay by card, bank transfer or USSD. It doesn't renew.
            </p>
            <input type="hidden" name="plan" value="once30" />
            <button className="primary" type="submit">
              Pay once
            </button>
          </form>
        ) : null}
      </div>
      <small>
        <Link href="/">Back</Link>
      </small>
    </main>
    </div>
  );
}
