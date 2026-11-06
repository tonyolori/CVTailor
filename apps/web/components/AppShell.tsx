import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { signOut } from "@/app/actions";
import { SideNav } from "@/components/SideNav";
import { isAdmin, setupStep } from "@/lib/auth";
import { ALLOWANCE_COLUMNS, cvAllowance, type AllowanceFields } from "@/lib/entitlement";
import { VIEWS, VISIBLE_DECISIONS, type MatchFacts } from "@/lib/views";

/** Sidebar and page frame for every signed-in screen. `active` names the sidebar label to highlight. */
export async function AppShell({ supabase, userId, email, active, children }: { supabase: SupabaseClient; userId: string; email: string; active: string; children: React.ReactNode }) {
  const [admin, setup, { data }, { data: profile }] = await Promise.all([
    isAdmin(email),
    setupStep(supabase, userId),
    supabase.from("matches").select("decision,tracker_status").eq("user_id", userId).in("decision", VISIBLE_DECISIONS).limit(5000),
    supabase.from("profiles").select(ALLOWANCE_COLUMNS).eq("id", userId).maybeSingle(),
  ]);
  const rows = (data ?? []) as MatchFacts[];
  const allowance = profile ? cvAllowance(profile as unknown as AllowanceFields) : null;

  const view = (key: string) => (
    <Link key={key} className={`nv ${active === key ? "on" : ""}`} aria-current={active === key ? "page" : undefined} href={`/dashboard?view=${key}`}>
      <span>{VIEWS[key]!.label}</span>
      <span>{rows.filter(VIEWS[key]!.holds).length}</span>
    </Link>
  );
  const page = (key: string, href: string, label: string) => (
    <Link className={`nv ${active === key ? "on" : ""}`} aria-current={active === key ? "page" : undefined} href={href}>
      <span>{label}</span>
    </Link>
  );

  return (
    <div className="app">
      <aside className="side">
        <SideNav>
          <Link className={`nv wr ${active === "write" ? "on" : ""}`} href="/write">
            <span>Write a CV</span>
            <span aria-hidden="true">+</span>
          </Link>
          {allowance && !allowance.unlimited ? (
            <Link className={`cvs-left ${allowance.left === 0 ? "none" : ""}`} href="/pricing">
              {allowance.left === 0 ? "No CVs left. Get more" : allowance.left === 1 ? "1 CV left" : `${allowance.left} CVs left`}
            </Link>
          ) : null}
          {["to_apply", "look", "unscored", "pasted"].map(view)}
          <div className="gp">Your applications</div>
          {["all", "applied", "interview", "offer", "rejected", "dismissed"].map(view)}
          <div className="gp">Your account</div>
          {page("library", "/library", "Library")}
          {page("preferences", "/preferences", "Preferences")}
          {page("settings", "/settings", "Settings")}
          {admin ? page("admin", "/admin", "Admin") : null}
          <div className="who">
            {email}
            <form action={signOut}>
              <button className="plain" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </SideNav>
      </aside>
      {setup ? (
        <div className="app-main">
          <div className="setup-bar" role="status">
            <span>
              <b>Finish setting up to get your matches.</b> {setup.step === 1 ? "Next: add your experience." : "Next: say what you're looking for."}
            </span>
            <Link className="button primary" href={setup.href}>
              Continue setup
            </Link>
          </div>
          {children}
        </div>
      ) : (
        children
      )}
    </div>
  );
}
