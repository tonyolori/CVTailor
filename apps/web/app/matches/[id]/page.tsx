import Link from "next/link";
import { notFound } from "next/navigation";
import { cvStyleOf, FactLibrarySchema, ResumeSchema, type Resume } from "@jobtailor/core";
import { AppShell } from "@/components/AppShell";
import { ResumeEditor, type VersionMeta } from "@/components/ResumeEditor";
import { requireOnboarded } from "@/lib/auth";
import { safeHref, VIEWS } from "@/lib/views";

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase, user, profile } = await requireOnboarded();
  const { id } = await params;
  const matchId = Number(id);
  if (!Number.isInteger(matchId)) notFound();

  const { data: match } = await supabase.from("matches").select("id,decision,tracker_status,cv_style,jobs(title,company,url,apply_url)").eq("id", matchId).eq("user_id", user.id).maybeSingle();
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

  const viewKey = Object.keys(VIEWS).find((k) => k !== "all" && VIEWS[k]!.holds({ decision: match.decision, tracker_status: match.tracker_status })) ?? "to_apply";
  const back = { href: `/dashboard?view=${viewKey}&job=${matchId}`, label: VIEWS[viewKey]!.label };
  const latest = versions[0];

  if (!latest) {
    return (
      <AppShell supabase={supabase} userId={user.id} email={user.email ?? ""} active={viewKey}>
        <main className="page">
          <h1>{job.title}</h1>
          <p className="muted">There's no CV for this role yet.</p>
          <div>
            <Link className="button" href={back.href}>
              Back to {back.label}
            </Link>
          </div>
        </main>
      </AppShell>
    );
  }

  return (
    <ResumeEditor
      matchId={matchId}
      title={job.title}
      company={job.company}
      apply={safeHref(job.apply_url) ?? safeHref(job.url)}
      back={back}
      hasLetter={Boolean(letter)}
      initial={latest.json}
      versions={versions}
      library={FactLibrarySchema.parse(facts?.data)}
      defaultStyle={cvStyleOf(profile.cv_style)}
      initialStyle={match.cv_style ? cvStyleOf(match.cv_style) : null}
    />
  );
}
