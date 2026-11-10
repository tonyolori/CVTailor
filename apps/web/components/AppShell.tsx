import Link from "next/link";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { signOut } from "@/app/actions";
import { NavLink } from "@/components/NavLink";
import { isAdmin, setupStep } from "@/lib/auth";
import { ALLOWANCE_COLUMNS, cvAllowance, type AllowanceFields } from "@/lib/entitlement";

/**
 * The top bar's data, once per request. A page can call this before its own queries so both load
 * together. AppShell only renders after the page's awaits, so on its own this would wait for them.
 */
export const loadShell = cache((supabase: SupabaseClient, userId: string, email: string) =>
  Promise.all([isAdmin(email), setupStep(supabase, userId), supabase.from("profiles").select(ALLOWANCE_COLUMNS).eq("id", userId).maybeSingle()]),
);

/** Which top-bar link a page sits under. */
export type ShellSection = "jobs" | "profile" | "settings" | "admin" | "write";

/** Top bar and page frame for every signed-in screen. */
export async function AppShell({ supabase, userId, email, active, children }: { supabase: SupabaseClient; userId: string; email: string; active: ShellSection; children: React.ReactNode }) {
  const [admin, setup, { data: profile }] = await loadShell(supabase, userId, email);
  const allowance = profile ? cvAllowance(profile as unknown as AllowanceFields) : null;

  const link = (key: ShellSection, href: string, label: string) => (
    <NavLink className="tn" current={active === key} href={href}>
      {label}
    </NavLink>
  );

  return (
    <div className="ui">
      <header className="top">
        <Link className="brand" href="/dashboard">
          CV Tailor
        </Link>
        <nav className="top-nav" aria-label="Main">
          {link("jobs", "/dashboard", "Jobs")}
          {link("profile", "/library", "Profile")}
          {link("settings", "/settings", "Settings")}
          {admin ? link("admin", "/admin", "Admin") : null}
        </nav>
        <div className="top-end">
          {allowance && !allowance.unlimited ? (
            <Link className={`left ${allowance.left === 0 ? "none" : ""}`} href="/pricing">
              {allowance.left === 0 ? "No CVs left" : allowance.left === 1 ? "1 CV left" : `${allowance.left} CVs left`}
            </Link>
          ) : null}
          <Link className="button sm" href="/write" aria-current={active === "write" ? "page" : undefined}>
            Add a job
          </Link>
          <details className="acct">
            <summary aria-label="Your account">{email.slice(0, 1) || "?"}</summary>
            <div className="acct-menu">
              <p>Signed in as {email}</p>
              <form action={signOut}>
                <button className="sm" type="submit">
                  Sign out
                </button>
              </form>
            </div>
          </details>
        </div>
      </header>
      {setup ? (
        <div className="setup-bar" role="status">
          <span>
            <b>Finish setting up to get your matches.</b> {setup.step === 1 ? "Next: add your experience." : "Next: say what you're looking for."}
          </span>
          <Link className="button primary sm" href={setup.href}>
            Continue setup
          </Link>
        </div>
      ) : null}
      {children}
    </div>
  );
}
