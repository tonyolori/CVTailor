import { cvStyleOf, EnrichedJobSchema } from "@jobtailor/core";
import { AppShell } from "@/components/AppShell";
import { MatchBoard, type BoardRow } from "@/components/MatchBoard";
import { requireOnboarded } from "@/lib/auth";
import { hasPaidFeatures } from "@/lib/entitlement";
import { loadMatchDetail } from "@/lib/match-detail";
import { safeHref, TRACKED_DECISIONS, VIEWS } from "@/lib/views";

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
  cv_style: string | null;
  posting_text: string | null;
  jobs: { title: string; company: string; url: string; apply_url: string | null; source: string; enriched: unknown; raw_text: string | null } | null;
}

/** A worker that died mid-task shouldn't leave a job saying "writing" forever. */
const WORKING_FOR_MS = 15 * 60_000;

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ view?: string; job?: string }> }) {
  const { supabase, user, profile } = await requireOnboarded();
  const params = await searchParams;
  const viewKey = VIEWS[params.view ?? ""] ? params.view! : "to_apply";

  let query = supabase
    .from("matches")
    .select("id,decision,score,reason,tier,tracker_status,tailor_status,tailor_error,verified,cv_style,posting_text,jobs(title,company,url,apply_url,source,enriched,raw_text)")
    .eq("user_id", user.id)
    .order("run_date", { ascending: false })
    .order("score", { ascending: false, nullsFirst: false })
    .limit(100);
  if (viewKey === "to_apply") query = query.eq("decision", "picked").eq("tracker_status", "to_apply");
  else if (viewKey === "look") query = query.eq("decision", "worth-a-look");
  else if (viewKey === "unscored") query = query.eq("decision", "unscored");
  else if (viewKey === "pasted") query = query.eq("decision", "pasted");
  else if (viewKey === "all") query = query.eq("decision", "picked");
  else query = query.in("decision", TRACKED_DECISIONS).eq("tracker_status", viewKey);

  const [{ data }, { data: latest }, { data: tasks }] = await Promise.all([
    query,
    supabase.from("daily_summaries").select("run_date,data").eq("user_id", user.id).order("run_date", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("ai_tasks").select("id,match_id,created_at").eq("user_id", user.id).eq("kind", "tailor_match").in("status", ["pending", "running"]),
  ]);
  const summary = latest?.data as { gaps?: string[]; notes?: string[]; sources?: { label: string }[]; closeCalls?: { company: string; title: string; reason: string; link?: string }[] } | undefined;
  const now = Date.now();
  const working = new Map((tasks ?? []).filter((t) => t.match_id && now - new Date(t.created_at).getTime() < WORKING_FOR_MS).map((t) => [t.match_id as number, t.id as number]));

  const rows: BoardRow[] = ((data ?? []) as unknown as Row[]).flatMap((r) => {
    const job = r.jobs;
    if (!job) return [];
    const parsed = EnrichedJobSchema.safeParse(job.enriched);
    const e = parsed.success ? parsed.data : null;
    return [
      {
        id: r.id,
        decision: r.decision,
        score: r.score == null ? null : Number(r.score),
        reason: r.reason,
        tier: r.tier,
        trackerStatus: r.tracker_status,
        tailorStatus: r.tailor_status,
        tailorError: r.tailor_error,
        verified: r.verified,
        cvStyle: r.cv_style ? cvStyleOf(r.cv_style) : null,
        title: job.title,
        company: job.company,
        original: safeHref(job.url),
        apply: safeHref(job.apply_url) ?? safeHref(job.url),
        locationQuote: e?.locationQuote ?? "",
        instructions: e?.applicantInstructions ?? [],
        hasPosting: Boolean(r.posting_text || job.raw_text?.trim()),
        taskId: working.get(r.id) ?? null,
      },
    ];
  });

  const asked = Number(params.job);
  const selected = rows.find((r) => r.id === asked)?.id ?? rows[0]?.id ?? null;
  const detail = selected ? await loadMatchDetail(supabase, selected) : null;

  return (
    <AppShell supabase={supabase} userId={user.id} email={user.email ?? ""} active={viewKey}>
      <MatchBoard
        key={viewKey}
        viewKey={viewKey}
        rows={rows}
        initialSelected={selected}
        initialDetail={detail}
        defaultStyle={cvStyleOf(profile.cv_style)}
        paid={hasPaidFeatures(profile)}
        lastRun={latest?.run_date ?? null}
        gaps={summary?.gaps ?? []}
        notes={summary?.notes ?? []}
        closeCalls={viewKey === "to_apply" || viewKey === "all" ? (summary?.closeCalls ?? []).map((c) => ({ ...c, link: safeHref(c.link) ?? undefined })) : []}
        sources={summary?.sources?.map((s) => s.label) ?? []}
      />
    </AppShell>
  );
}
