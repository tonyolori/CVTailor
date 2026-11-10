import { cvStyleOf, EnrichedJobSchema } from "@cvtailor/core";
import { expireCvRequests } from "@cvtailor/ai/cv-request";
import { AppShell, loadShell } from "@/components/AppShell";
import { JobsBoard, type BoardRow } from "@/components/JobsBoard";
import { requireUser } from "@/lib/auth";
import { cvAllowance } from "@/lib/entitlement";
import { loadMatchDetail } from "@/lib/match-detail";
import { adminClient } from "@/lib/supabase/admin";
import { inStage, safeHref, STAGE_KEYS, STAGES, stageKey, stageOf, VISIBLE_DECISIONS } from "@/lib/views";

export const metadata = { title: "Jobs - CV Tailor" };

interface Row {
  id: number;
  decision: string;
  reason: string | null;
  tracker_status: string;
  tailor_status: string;
  tailor_error: string | null;
  cv_style: string | null;
  posting_text: string | null;
  run_date: string;
  jobs: { title: string; company: string; url: string; apply_url: string | null; enriched: unknown; raw_text: string | null; location_text: string | null; work_mode: string | null } | null;
}

const MODES: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" };

const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ view?: string; job?: string }> }) {
  const { supabase, user, profile } = await requireUser();
  void loadShell(supabase, user.id, user.email ?? "");
  const params = await searchParams;
  const asked = Number(params.job);
  const askedId = Number.isInteger(asked) && asked > 0 ? asked : null;

  // A link to one job, such as from the morning email, opens the tab that holds it.
  let key = stageKey(params.view);
  if (!key && askedId) {
    const { data } = await supabase.from("matches").select("tracker_status").eq("id", askedId).eq("user_id", user.id).maybeSingle();
    key = data ? stageOf(data.tracker_status as string) : null;
  }
  const stage = key ?? "to_apply";

  const [{ data }, { data: all }, { data: latest }, { data: running }, askedDetail] = await Promise.all([
    supabase
      .from("matches")
      .select("id,decision,reason,tracker_status,tailor_status,tailor_error,cv_style,posting_text,run_date,jobs(title,company,url,apply_url,enriched,raw_text,location_text,work_mode)")
      .eq("user_id", user.id)
      .in("decision", VISIBLE_DECISIONS)
      .in("tracker_status", STAGES[stage]!.statuses)
      .order("run_date", { ascending: false })
      .order("score", { ascending: false, nullsFirst: false })
      .limit(200),
    supabase.from("matches").select("decision,tracker_status").eq("user_id", user.id).in("decision", VISIBLE_DECISIONS).limit(5000),
    supabase.from("daily_summaries").select("run_date,data").eq("user_id", user.id).order("run_date", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("cv_requests").select("id,match_id").eq("user_id", user.id).eq("status", "running"),
    askedId ? loadMatchDetail(supabase, askedId) : null,
    // A CV cut off with its function shouldn't say "writing" forever, or keep the CV it took. Not
    // waited on before the query above: the board polls anything shown as writing, and the poll
    // ends expired ones too.
    expireCvRequests(adminClient(), user.id),
  ]);
  const summary = latest?.data as { gaps?: string[]; notes?: string[]; sources?: { label: string }[]; closeCalls?: { company: string; title: string; reason: string; link?: string }[] } | undefined;
  const working = new Map((running ?? []).map((r) => [r.match_id as number, r.id as number]));
  const facts = (all ?? []) as { decision: string; tracker_status: string }[];
  const counts = Object.fromEntries(STAGE_KEYS.map((k) => [k, facts.filter((m) => inStage(k, m)).length]));

  const rows: BoardRow[] = ((data ?? []) as unknown as Row[]).flatMap((r) => {
    const job = r.jobs;
    if (!job) return [];
    const parsed = EnrichedJobSchema.safeParse(job.enriched);
    const e = parsed.success ? parsed.data : null;
    return [
      {
        id: r.id,
        decision: r.decision,
        reason: r.reason,
        trackerStatus: r.tracker_status,
        tailorStatus: r.tailor_status,
        tailorError: r.tailor_error,
        cvStyle: r.cv_style ? cvStyleOf(r.cv_style) : null,
        title: job.title,
        company: job.company,
        where: [job.location_text?.trim(), MODES[job.work_mode ?? ""]].filter(Boolean).join(" · "),
        found: shortDate(r.run_date),
        original: safeHref(job.url),
        apply: safeHref(job.apply_url) ?? safeHref(job.url),
        locationQuote: e?.locationQuote ?? "",
        instructions: e?.applicantInstructions ?? [],
        hasPosting: Boolean(r.posting_text || job.raw_text?.trim()),
        requestId: working.get(r.id) ?? null,
      },
    ];
  });

  const selected = rows.find((r) => r.id === askedId)?.id ?? rows[0]?.id ?? null;
  const detail = selected === askedId ? askedDetail : null;

  return (
    <AppShell supabase={supabase} userId={user.id} email={user.email ?? ""} active="jobs">
      <JobsBoard
        key={stage}
        stageKey={stage}
        rows={rows}
        counts={counts}
        initialSelected={selected}
        initialDetail={detail}
        initialOpen={selected !== null && selected === askedId}
        defaultStyle={cvStyleOf(profile.cv_style)}
        allowance={cvAllowance(profile)}
        lastRun={latest?.run_date ? new Date(`${latest.run_date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }) : null}
        gaps={summary?.gaps ?? []}
        notes={summary?.notes ?? []}
        closeCalls={stage === "to_apply" ? (summary?.closeCalls ?? []).map((c) => ({ ...c, link: safeHref(c.link) ?? undefined })) : []}
        sources={summary?.sources?.map((s) => s.label) ?? []}
      />
    </AppShell>
  );
}
