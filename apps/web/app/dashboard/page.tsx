import Link from "next/link";
import { EnrichedJobSchema } from "@jobtailor/core";
import { Nav } from "@/components/Nav";
import { StatusSelect } from "@/components/StatusSelect";
import { requireOnboarded } from "@/lib/auth";

interface Row {
  id: number;
  decision: string;
  score: number | string | null;
  reason: string | null;
  tier: string | null;
  tracker_status: string;
  tailor_status: string;
  tailor_error: string | null;
  verified: boolean | null;
  run_date: string;
  jobs: { title: string; company: string; url: string; apply_url: string | null; source: string; enriched: unknown; posted_at: string | null } | null;
}

const VIEWS: Record<string, { label: string; decisions: string[] }> = {
  picks: { label: "To apply", decisions: ["picked"] },
  look: { label: "Worth a look", decisions: ["worth-a-look"] },
  unscored: { label: "Not scored", decisions: ["unscored"] },
};

const STATUS_FILTERS = ["all", "to_apply", "applied", "interview", "offer", "rejected", "dismissed"];

function Score({ value }: { value: number }) {
  return <span className={`chip ${value >= 9 ? "ok" : value >= 8 ? "info" : "warn"}`}>{value}/10</span>;
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ view?: string; status?: string }> }) {
  const { supabase, user } = await requireOnboarded();
  const params = await searchParams;
  const view = VIEWS[params.view ?? ""] ? params.view! : "picks";
  const status = STATUS_FILTERS.includes(params.status ?? "") ? params.status! : "all";

  let query = supabase
    .from("matches")
    .select("id,decision,score,reason,tier,tracker_status,tailor_status,tailor_error,verified,run_date,jobs(title,company,url,apply_url,source,enriched,posted_at)")
    .eq("user_id", user.id)
    .in("decision", VIEWS[view]!.decisions)
    .order("run_date", { ascending: false })
    .order("score", { ascending: false, nullsFirst: false })
    .limit(100);
  if (status !== "all") query = query.eq("tracker_status", status);
  const { data } = await query;
  const rows = (data ?? []) as unknown as Row[];

  const { data: latest } = await supabase
    .from("daily_summaries")
    .select("run_date,data")
    .eq("user_id", user.id)
    .order("run_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const summary = latest?.data as { gaps?: string[]; notes?: string[]; sources?: { label: string }[]; closeCalls?: { company: string; title: string; reason: string; link?: string }[] } | undefined;

  return (
    <>
      <Nav email={user.email ?? ""} />
      <main className="page">
        <div className="row between">
          <h1>Your matches</h1>
          {latest ? <small className="muted">Last run {latest.run_date}</small> : null}
        </div>

        {summary?.gaps?.map((g) => (
          <div className="notice warn" key={g}>
            {g}
          </div>
        ))}
        {summary?.notes?.map((n) => (
          <div className="notice" key={n}>
            {n}
          </div>
        ))}

        <div className="row">
          {Object.entries(VIEWS).map(([key, v]) => (
            <Link key={key} className={`button ${view === key ? "primary" : ""}`} href={`/dashboard?view=${key}`}>
              {v.label}
            </Link>
          ))}
        </div>

        {view === "picks" ? (
          <div className="row">
            <small className="muted">Show:</small>
            {STATUS_FILTERS.map((s) => (
              <Link key={s} href={`/dashboard?view=picks&status=${s}`} className={status === s ? "" : "muted"}>
                <small>{s.replace("_", " ")}</small>
              </Link>
            ))}
          </div>
        ) : null}

        {rows.length === 0 ? (
          <div className="card">
            <p className="muted">
              {latest
                ? "Nothing here yet."
                : "Your first results will appear after the next daily run. They usually land in the morning, at the time set in your settings."}
            </p>
          </div>
        ) : null}

        {rows.map((r) => {
          const job = r.jobs;
          if (!job) return null;
          const parsed = EnrichedJobSchema.safeParse(job.enriched);
          const e = parsed.success ? parsed.data : null;
          return (
            <div className="card" key={r.id}>
              <div className="row between">
                <div className="stack" style={{ gap: 2 }}>
                  <h2>{job.title}</h2>
                  <span className="muted">{job.company}</span>
                </div>
                <div className="row">
                  {r.score != null ? <Score value={Number(r.score)} /> : null}
                  {r.tier && r.tier !== "core" ? <span className="chip">tier {r.tier.toUpperCase()}</span> : null}
                  {r.verified === false ? <span className="chip bad">Unverified</span> : null}
                  {r.tailor_status === "failed" ? <span className="chip bad">No CV</span> : null}
                </div>
              </div>
              {r.reason ? <p>{r.reason}</p> : null}
              {e?.locationQuote ? <small className="muted overflow-wrap">Location: {e.locationQuote}</small> : null}
              {e?.applicantInstructions.length ? (
                <div className="notice warn">The posting asks applicants: {e.applicantInstructions.join(" ")}</div>
              ) : null}
              {r.tailor_status === "failed" ? (
                <div className="notice bad">
                  {r.tailor_error === "failed_fact_check"
                    ? "A CV for this role kept including things that aren't in your library, so it wasn't delivered. You can still apply."
                    : "A CV couldn't be written for this role. You can still apply."}
                </div>
              ) : null}
              <div className="row between">
                <div className="row">
                  <a className="button primary" href={job.apply_url ?? job.url} target="_blank" rel="noreferrer">
                    Apply
                  </a>
                  {job.apply_url && job.apply_url !== job.url ? (
                    <a className="button" href={job.url} target="_blank" rel="noreferrer">
                      Posting
                    </a>
                  ) : null}
                  {r.decision === "picked" && r.tailor_status === "rendered" ? (
                    <Link className="button" href={`/matches/${r.id}`}>
                      Edit CV
                    </Link>
                  ) : null}
                </div>
                {r.decision === "picked" ? <StatusSelect matchId={r.id} value={r.tracker_status} /> : null}
              </div>
            </div>
          );
        })}

        {summary?.closeCalls?.length && view === "picks" ? (
          <div className="card">
            <h2>Close calls</h2>
            {summary.closeCalls.map((c) => (
              <p key={`${c.company}${c.title}`}>
                {c.link ? (
                  <a href={c.link} target="_blank" rel="noreferrer">
                    {c.title}, {c.company}
                  </a>
                ) : (
                  `${c.title}, ${c.company}`
                )}
                <span className="muted"> {c.reason}</span>
              </p>
            ))}
          </div>
        ) : null}

        {summary?.sources?.length ? <small className="muted">Sources searched: {summary.sources.map((s) => s.label).join(", ")}</small> : null}
      </main>
    </>
  );
}
