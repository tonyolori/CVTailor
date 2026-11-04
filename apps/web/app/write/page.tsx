import { cvStyleOf } from "@cvtailor/core";
import { AppShell } from "@/components/AppShell";
import { WriteCv } from "@/components/WriteCv";
import { requireOnboarded } from "@/lib/auth";
import { cvAllowance } from "@/lib/entitlement";

export const metadata = { title: "Write a CV - CV Tailor" };

/** Paste any job, get a CV from your own library. `?match=` arrives from a job we hold no text for. */
export default async function WritePage({ searchParams }: { searchParams: Promise<{ match?: string }> }) {
  const { supabase, user, profile } = await requireOnboarded();
  const matchId = Number((await searchParams).match);
  let forMatch: { id: number; title: string; company: string } | null = null;
  if (Number.isInteger(matchId) && matchId > 0) {
    const { data } = await supabase.from("matches").select("id,jobs(title,company)").eq("id", matchId).maybeSingle();
    const job = data?.jobs as unknown as { title: string; company: string } | null;
    if (data && job) forMatch = { id: data.id, title: job.title, company: job.company };
  }
  return (
    <AppShell supabase={supabase} userId={user.id} email={user.email ?? ""} active="write">
      <WriteCv allowance={cvAllowance(profile)} style={cvStyleOf(profile.cv_style)} forMatch={forMatch} />
    </AppShell>
  );
}
