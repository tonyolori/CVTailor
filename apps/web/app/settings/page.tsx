import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { SettingsForm } from "@/components/SettingsForm";
import { SettingsTabs } from "@/components/SettingsTabs";
import { requireUser } from "@/lib/auth";
import { cvAllowance } from "@/lib/entitlement";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; paid?: string; resent?: string }> }) {
  const { supabase, user, profile } = await requireUser();
  const { error, paid, resent } = await searchParams;
  const paidUntil = profile.paid_until ? new Date(profile.paid_until) : null;
  const allowance = cvAllowance(profile);
  return (
    <AppShell supabase={supabase} userId={user.id} email={user.email ?? ""} active="settings">
      <main className="page">
        <h1>Settings</h1>
        <SettingsTabs active="general" />
        {paid ? <div className="notice">Thanks. Your plan and CVs update as soon as Paystack confirms the payment, usually within a minute.</div> : null}
        {error === "confirm" ? <div className="notice bad">Type "delete" to confirm.</div> : null}
        {resent ? <div className="notice ok">We sent the link again. It works for 7 days.</div> : null}
        {error === "resend" ? <div className="notice bad">The link couldn&apos;t be sent again just now. Try again later.</div> : null}
        {error === "delete" ? <div className="notice bad">Your account couldn't be deleted. Please try again.</div> : null}

        <SettingsForm profile={profile} zones={Intl.supportedValuesOf("timeZone")} />

        <div className="card">
          <h2>Plan</h2>
          <p>
            {profile.plan === "pro" && paidUntil && paidUntil > new Date()
              ? `Paid until ${paidUntil.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.`
              : "Free."}{" "}
            <Link href="/pricing">See plans</Link>
          </p>
          {allowance.unlimited ? null : (
            <p>
              You have <b>{allowance.left === 1 ? "1 CV" : `${allowance.left} CVs`} left</b>
              {[allowance.plan ? `${allowance.plan} from your plan` : "", allowance.free ? `${allowance.free} free` : "", allowance.extra ? `${allowance.extra} extra` : ""].filter(Boolean).length > 1
                ? `: ${[allowance.plan ? `${allowance.plan} from your plan` : "", allowance.free ? `${allowance.free} free` : "", allowance.extra ? `${allowance.extra} extra` : ""].filter(Boolean).join(", ")}`
                : ""}
              .
            </p>
          )}
        </div>

        <div className="card">
          <h2>Your data</h2>
          <p className="muted">Download everything held about you: your library, preferences, matches, jobs you've pasted in, CVs and your CV allowance history. See also the <Link href="/privacy?from=/settings">privacy page</Link>.</p>
          <div>
            <a className="button" href="/api/export">
              Download my data
            </a>
          </div>
        </div>

        <form className="card" action="/api/account/delete" method="post">
          <h2>Delete my account</h2>
          <p className="muted">This permanently removes your library, CVs, matches and files. It can't be undone.</p>
          <label>
            Type "delete" to confirm
            <input name="confirm" autoComplete="off" />
          </label>
          <div>
            <button className="danger" type="submit">
              Delete my account
            </button>
          </div>
        </form>
      </main>
    </AppShell>
  );
}
