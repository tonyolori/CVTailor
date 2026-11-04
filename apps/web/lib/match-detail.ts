import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EnrichedJobSchema, ResumeSchema, type Resume } from "@jobtailor/core";
import { safeHref } from "./views";

export interface MatchDetail {
  resume: Resume | null;
  hasLetter: boolean;
  posting: { text: string | null; mustHaves: string[]; source: string };
  job: { title: string; company: string; apply: string | null };
}

/** What the right-hand side of the dashboard shows for one match. RLS limits this to the user's own. */
export async function loadMatchDetail(supabase: SupabaseClient, matchId: number): Promise<MatchDetail | null> {
  const [{ data: match }, { data: versions }] = await Promise.all([
    supabase.from("matches").select("posting_text,jobs(raw_text,enriched,source,title,company,url,apply_url)").eq("id", matchId).maybeSingle(),
    supabase.from("resume_versions").select("kind,json,created_at").eq("match_id", matchId).order("created_at", { ascending: false }),
  ]);
  if (!match) return null;
  const job = match.jobs as unknown as { raw_text: string | null; enriched: unknown; source: string; title: string; company: string; url: string; apply_url: string | null } | null;
  const enriched = EnrichedJobSchema.safeParse(job?.enriched);
  const latest = (versions ?? []).find((v) => v.kind === "resume");
  const parsed = latest ? ResumeSchema.safeParse(latest.json) : null;
  return {
    resume: parsed?.success ? parsed.data : null,
    hasLetter: (versions ?? []).some((v) => v.kind === "cover_letter"),
    posting: {
      text: match.posting_text ?? job?.raw_text ?? null,
      mustHaves: enriched.success ? enriched.data.mustHaves : [],
      source: job?.source ?? "",
    },
    job: { title: job?.title ?? "", company: job?.company ?? "", apply: safeHref(job?.apply_url) ?? safeHref(job?.url) },
  };
}
