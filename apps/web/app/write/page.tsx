import { AppShell } from "@/components/AppShell";
import { WriteCv, type WritePrefill } from "@/components/WriteCv";
import { requireUser } from "@/lib/auth";
import { cvAllowance } from "@/lib/entitlement";
import { safeHref } from "@/lib/views";

export const metadata = { title: "Add a job - CV Tailor" };

/**
 * Paste any job, get a CV from your own library. `?match=` arrives from a job we hold no text for,
 * and `?job=` from All jobs, which fills the form in with what we hold for that job.
 */
export default async function WritePage({ searchParams }: { searchParams: Promise<{ match?: string; job?: string }> }) {
  const { supabase, user, profile } = await requireUser();
  const params = await searchParams;
  const matchId = Number(params.match);
  const jobId = Number(params.job);
  let prefill: WritePrefill | null = null;
  if (Number.isInteger(jobId) && jobId > 0) {
    // RLS limits this to shared jobs and the person's own pasted ones.
    const { data } = await supabase.from("jobs").select("title,company,url,apply_url,raw_text").eq("id", jobId).maybeSingle();
    if (data) prefill = { title: data.title, company: data.company, link: safeHref(data.apply_url) ?? safeHref(data.url) ?? "", text: data.raw_text?.trim() ?? "" };
  }
  let forMatch: { id: number; title: string; company: string } | null = null;
  if (Number.isInteger(matchId) && matchId > 0) {
    const { data } = await supabase.from("matches").select("id,jobs(title,company)").eq("id", matchId).maybeSingle();
    const job = data?.jobs as unknown as { title: string; company: string } | null;
    if (data && job) forMatch = { id: data.id, title: job.title, company: job.company };
  }
  return (
    <AppShell supabase={supabase} userId={user.id} email={user.email ?? ""} active="write">
      <WriteCv allowance={cvAllowance(profile)} forMatch={forMatch} prefill={prefill} />
    </AppShell>
  );
}
