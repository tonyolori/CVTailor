import { cvStyleOf, ResumeSchema, type Resume } from "@cvtailor/core";
import { AppShell } from "@/components/AppShell";
import { CvStylePicker } from "@/components/CvStylePicker";
import { requireOnboarded } from "@/lib/auth";
import { landingExample } from "@/lib/landing-examples";

export const metadata = { title: "CV style - CV Tailor" };

export default async function CvStylePage() {
  const { supabase, user, profile } = await requireOnboarded();
  const { data } = await supabase.from("resume_versions").select("json").eq("user_id", user.id).eq("kind", "resume").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const parsed = ResumeSchema.safeParse(data?.json);
  // Your own latest CV if there is one, so you judge the style on your real words.
  const sample: Resume = parsed.success ? parsed.data : landingExample(0)[0]!.resume;
  return (
    <AppShell supabase={supabase} userId={user.id} email={user.email ?? ""} active="settings">
      <CvStylePicker current={cvStyleOf(profile.cv_style)} sample={sample} isOwn={parsed.success} />
    </AppShell>
  );
}
