import Link from "next/link";
import { AppShell, loadShell } from "@/components/AppShell";
import { requireUser } from "@/lib/auth";
import { safeHref, sourceLabel, VISIBLE_DECISIONS } from "@/lib/views";

export const metadata = { title: "All jobs - CV Tailor" };

const PER_PAGE = 30;
const MODES: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" };

interface JobRow {
  id: number;
  title: string;
  company: string;
  url: string;
  apply_url: string | null;
  source: string;
  location_text: string | null;
  work_mode: string | null;
  category: string | null;
  posted_at: string | null;
  first_seen: string;
}

function ago(iso: string, now: number): string {
  const days = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/**
 * Every open job the daily run has collected, not only the ones matched to this person. Shared
 * jobs only: a pasted job belongs to the person who pasted it.
 */
export default async function JobsPage({ searchParams }: { searchParams: Promise<{ q?: string; field?: string; mode?: string; page?: string }> }) {
  const { supabase, user } = await requireUser();
  void loadShell(supabase, user.id, user.email ?? "");
  const params = await searchParams;
  // Characters that mean something in a PostgREST filter come out, so a search can't change the query.
  const q = (params.q ?? "").replace(/[,()%*\\:"']/g, " ").trim().slice(0, 80);
  const mode = MODES[params.mode ?? ""] ? params.mode! : "";
  const field = (params.field ?? "").slice(0, 60);
  const page = Math.max(1, Math.min(100, Math.floor(Number(params.page)) || 1));

  let query = supabase
    .from("jobs")
    .select("id,title,company,url,apply_url,source,location_text,work_mode,category,posted_at,first_seen", { count: "exact" })
    .is("owner_id", null)
    .not("status", "in", "(closed,failed)")
    .order("first_seen", { ascending: false })
    .order("id", { ascending: false })
    .range((page - 1) * PER_PAGE, page * PER_PAGE - 1);
  if (q) query = query.or(`title.ilike.*${q}*,company.ilike.*${q}*`);
  if (mode) query = query.eq("work_mode", mode);
  if (field) query = query.eq("category", field);

  const [{ data, count }, { data: categories }] = await Promise.all([query, supabase.from("categories").select("id,label").order("label")]);
  const jobs = (data ?? []) as JobRow[];
  const { data: mine } = jobs.length
    ? await supabase.from("matches").select("id,job_id,decision").eq("user_id", user.id).in("job_id", jobs.map((j) => j.id))
    : { data: [] };
  const held = new Map((mine ?? []).filter((m) => VISIBLE_DECISIONS.includes(m.decision as string)).map((m) => [m.job_id as number, m as { id: number; decision: string }]));
  const fieldLabel = new Map((categories ?? []).map((c) => [c.id as string, c.label as string]));
  const total = count ?? 0;
  const now = Date.now();

  const pageHref = (n: number) => {
    const s = new URLSearchParams();
    if (q) s.set("q", q);
    if (field) s.set("field", field);
    if (mode) s.set("mode", mode);
    if (n > 1) s.set("page", String(n));
    const str = s.toString();
    return str ? `/jobs?${str}` : "/jobs";
  };

  return (
    <AppShell supabase={supabase} userId={user.id} email={user.email ?? ""} active="jobs">
      <main className="page wide">
        <div>
          <h1>All jobs</h1>
          <p className="sub">Every open job we&apos;ve found, newest first. The ones picked for you each morning are under Jobs.</p>
        </div>
        <form className="jobs-filter" action="/jobs" role="search">
          <label>
            Search
            <input name="q" type="search" defaultValue={q} placeholder="Job title or company" />
          </label>
          <label>
            Field
            <select name="field" defaultValue={field}>
              <option value="">Any field</option>
              {(categories ?? []).map((c) => (
                <option key={c.id as string} value={c.id as string}>
                  {c.label as string}
                </option>
              ))}
            </select>
          </label>
          <label>
            Work mode
            <select name="mode" defaultValue={mode}>
              <option value="">Any</option>
              {Object.entries(MODES).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Show jobs</button>
        </form>

        <p className="muted" aria-live="polite">
          {total === 0 ? "No jobs match that." : total === 1 ? "1 job" : `${total.toLocaleString("en-GB")} jobs`}
          {q || field || mode ? (
            <>
              {" "}
              · <Link href="/jobs">Clear filters</Link>
            </>
          ) : null}
        </p>

        <ul className="jobs-list">
          {jobs.map((j) => {
            const link = safeHref(j.url);
            const from = sourceLabel(j.source);
            const match = held.get(j.id);
            const place = [j.work_mode ? MODES[j.work_mode] : null, j.location_text?.trim()].filter(Boolean).join(" · ");
            return (
              <li key={j.id}>
                <div className="jl-main">
                  <h2>{j.title}</h2>
                  <p className="jl-co">{j.company}</p>
                  <p className="jl-meta">
                    {[place, j.category ? fieldLabel.get(j.category) : null, ago(j.posted_at ?? j.first_seen, now)].filter(Boolean).join(" · ")}
                    {from ? <> · Found through {from}</> : null}
                  </p>
                </div>
                <div className="jl-act">
                  {link ? (
                    <a className="button" href={link} target="_blank" rel="noopener">
                      View job
                    </a>
                  ) : null}
                  {match ? (
                    <Link className="button quiet" href={`/dashboard?job=${match.id}`}>
                      In your jobs
                    </Link>
                  ) : (
                    <Link className="button" href={`/write?job=${j.id}`}>
                      Tailor a CV
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {total > PER_PAGE ? (
          <nav className="row" aria-label="Pages">
            {page > 1 ? <Link className="button" href={pageHref(page - 1)}>Newer</Link> : null}
            <small className="muted">
              Page {page} of {Math.ceil(total / PER_PAGE)}
            </small>
            {page * PER_PAGE < total ? <Link className="button" href={pageHref(page + 1)}>Older</Link> : null}
          </nav>
        ) : null}
      </main>
    </AppShell>
  );
}
