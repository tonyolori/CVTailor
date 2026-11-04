import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { signOut } from "@/app/actions";
import { SideNav } from "@/components/SideNav";
import { isAdmin } from "@/lib/auth";
import { VIEWS, VISIBLE_DECISIONS, type MatchFacts } from "@/lib/views";

/** Sidebar and page frame for every signed-in screen. `active` names the sidebar label to highlight. */
export async function AppShell({ supabase, userId, email, active, children }: { supabase: SupabaseClient; userId: string; email: string; active: string; children: React.ReactNode }) {
  const [admin, { data }] = await Promise.all([
    isAdmin(email),
    supabase.from("matches").select("decision,tracker_status").eq("user_id", userId).in("decision", VISIBLE_DECISIONS).limit(5000),
  ]);
  const rows = (data ?? []) as MatchFacts[];

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
      {children}
    </div>
  );
}
