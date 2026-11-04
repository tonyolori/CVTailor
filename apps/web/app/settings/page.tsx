import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { SettingsForm } from "@/components/SettingsForm";
import { SettingsTabs } from "@/components/SettingsTabs";
import { requireOnboarded } from "@/lib/auth";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; paid?: string }> }) {
  const { supabase, user, profile } = await requireOnboarded();
  const { error, paid } = await searchParams;
  const paidUntil = profile.paid_until ? new Date(profile.paid_until) : null;
  return (
    <AppShell supabase={supabase} userId={user.id} email={user.email ?? ""} active="settings">
      <main className="page">
        <h1>Settings</h1>
        <SettingsTabs active="general" />
        {paid ? <div className="notice">Thanks. Your plan updates as soon as Paystack confirms the payment, usually within a minute.</div> : null}
        {error === "confirm" ? <div className="notice bad">Type "delete" to confirm.</div> : null}
        {error === "delete" ? <div className="notice bad">Your account couldn't be deleted. Please try again.</div> : null}

        <SettingsForm profile={profile} />

        <div className="card">
          <h2>Plan</h2>
          <p>
            {profile.plan === "pro" && paidUntil && paidUntil > new Date()
              ? `Paid until ${paidUntil.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.`
              : "Free."}{" "}
            <Link href="/pricing">See plans</Link>
          </p>
        </div>

        <div className="card">
          <h2>Your data</h2>
          <p className="muted">Download everything held about you: your library, preferences, matches, jobs you've pasted in and CVs. See also the <Link href="/privacy">privacy page</Link>.</p>
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
