import Link from "next/link";
import { redirect } from "next/navigation";
import { cvStyleOf } from "@cvtailor/core";
import { OnboardingLibrary } from "@/components/OnboardingLibrary";
import { requireUser } from "@/lib/auth";

export default async function OnboardingPage() {
  const { supabase, user, profile } = await requireUser();
  const { data } = await supabase.from("fact_library").select("user_id").eq("user_id", user.id).maybeSingle();
  if (data) redirect("/onboarding/preferences");
  return (
    <div className="public ui">
      <div className="public-top">
        <Link className="logo" href="/">
          CV Tailor
        </Link>
        <Link href="/dashboard">Dashboard</Link>
      </div>
      <main className="page pe-page">
        <div>
          <small className="muted">Step 1 of 2</small>
          <h1>Your experience</h1>
        </div>
        <OnboardingLibrary email={profile.email} displayName={profile.display_name ?? ""} consented={Boolean(profile.consented_at)} style={cvStyleOf(profile.cv_style)} />
      </main>
    </div>
  );
}
