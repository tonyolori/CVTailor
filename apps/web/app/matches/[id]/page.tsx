import Link from "next/link";
import { notFound } from "next/navigation";
import { FactLibrarySchema, ResumeSchema, type Resume } from "@jobtailor/core";
import { Nav } from "@/components/Nav";
import { ResumeEditor, type VersionMeta } from "@/components/ResumeEditor";
import { requireOnboarded } from "@/lib/auth";

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await requireOnboarded();
  const { id } = await params;
  const matchId = Number(id);
  if (!Number.isInteger(matchId)) notFound();

  const { data: match } = await supabase.from("matches").select("id,jobs(title,company,url,apply_url)").eq("id", matchId).eq("user_id", user.id).maybeSingle();
  if (!match) notFound();
  const job = match.jobs as unknown as { title: string; company: string; url: string; apply_url: string | null };

  const [{ data: versionRows }, { data: letter }, { data: facts }] = await Promise.all([
    supabase.from("resume_versions").select("id,source,created_at,json").eq("match_id", matchId).eq("kind", "resume").order("created_at", { ascending: false }),
    supabase.from("resume_versions").select("id").eq("match_id", matchId).eq("kind", "cover_letter").limit(1).maybeSingle(),
    supabase.from("fact_library").select("data").eq("user_id", user.id).single(),
  ]);

  const versions: VersionMeta[] = (versionRows ?? []).flatMap((v) => {
    const parsed = ResumeSchema.safeParse(v.json);
    return parsed.success ? [{ id: v.id, source: v.source, created_at: v.created_at, json: parsed.data as Resume }] : [];
  });
  const latest = versions[0];
  if (!latest) {
    return (
      <>
        <Nav email={user.email ?? ""} />
        <main className="page">
          <div className="card">
            <h1>{job.title}</h1>
            <p className="muted">There's no CV for this role.</p>
            <Link href="/dashboard">Back to matches</Link>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Nav email={user.email ?? ""} />
      <main className="page wide">
        <div className="row between">
          <div>
            <h1>{job.title}</h1>
            <span className="muted">{job.company}</span>
          </div>
          <div className="row">
            {letter ? (
              <a className="button" href={`/api/documents/${matchId}?kind=cover_letter`}>
                Cover letter PDF
              </a>
            ) : null}
            <a className="button primary" href={job.apply_url ?? job.url} target="_blank" rel="noreferrer">
              Apply
            </a>
          </div>
        </div>
        <ResumeEditor matchId={matchId} initial={latest.json} versions={versions} library={FactLibrarySchema.parse(facts?.data)} />
      </main>
    </>
  );
}
