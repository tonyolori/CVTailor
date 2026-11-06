import { cvStyleOf, EnrichedJobSchema } from "@cvtailor/core";
import { expireCvRequests } from "@cvtailor/ai/cv-request";
import { AppShell, loadShell } from "@/components/AppShell";
import { MatchBoard, type BoardRow } from "@/components/MatchBoard";
import { requireUser } from "@/lib/auth";
import { cvAllowance } from "@/lib/entitlement";
import { loadMatchDetail } from "@/lib/match-detail";
import { adminClient } from "@/lib/supabase/admin";
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

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ view?: string; job?: string }> }) {
  const { supabase, user, profile } = await requireUser();
  void loadShell(supabase, user.id, user.email ?? "");
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

  const asked = Number(params.job);
  // A link to one job opens on it, so its details load alongside the list. A tab switch leaves them to the board.
  const [{ data }, { data: latest }, { data: running }, askedDetail] = await Promise.all([
    query,
    supabase.from("daily_summaries").select("run_date,data").eq("user_id", user.id).order("run_date", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("cv_requests").select("id,match_id").eq("user_id", user.id).eq("status", "running"),
    // A CV cut off with its function shouldn't say "writing" forever, or keep the CV it took. Not
    // waited on before the query above: the board polls anything shown as writing, and the poll
    // ends expired ones too.
    Number.isInteger(asked) && asked > 0 ? loadMatchDetail(supabase, asked) : null,
    expireCvRequests(adminClient(), user.id),
  ]);
  const summary = latest?.data as { gaps?: string[]; notes?: string[]; sources?: { label: string }[]; closeCalls?: { company: string; title: string; reason: string; link?: string }[] } | undefined;
  const working = new Map((running ?? []).map((r) => [r.match_id as number, r.id as number]));

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
        requestId: working.get(r.id) ?? null,
      },
    ];
  });

  const selected = rows.find((r) => r.id === asked)?.id ?? rows[0]?.id ?? null;
  const detail = selected === asked ? askedDetail : null;

  return (
    <AppShell supabase={supabase} userId={user.id} email={user.email ?? ""} active={viewKey}>
      <MatchBoard
        key={viewKey}
        viewKey={viewKey}
        rows={rows}
        initialSelected={selected}
        initialDetail={detail}
        defaultStyle={cvStyleOf(profile.cv_style)}
        allowance={cvAllowance(profile)}
        lastRun={latest?.run_date ? new Date(`${latest.run_date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }) : null}
        gaps={summary?.gaps ?? []}
        notes={summary?.notes ?? []}
        closeCalls={viewKey === "to_apply" || viewKey === "all" ? (summary?.closeCalls ?? []).map((c) => ({ ...c, link: safeHref(c.link) ?? undefined })) : []}
        sources={summary?.sources?.map((s) => s.label) ?? []}
      />
    </AppShell>
  );
}
