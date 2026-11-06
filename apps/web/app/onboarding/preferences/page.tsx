import Link from "next/link";
import { redirect } from "next/navigation";
import { cvStyleOf } from "@cvtailor/core";
import { OnboardingPreferences } from "@/components/OnboardingPreferences";
import { countryOptions } from "@/lib/countries";
import { requireUser } from "@/lib/auth";
import { landingExample } from "@/lib/landing-examples";

export default async function OnboardingPreferencesPage() {
  const { supabase, user, profile } = await requireUser();
  if (!profile.consented_at) redirect("/onboarding");
  const { data: facts } = await supabase.from("fact_library").select("user_id").eq("user_id", user.id).maybeSingle();
  if (!facts) redirect("/onboarding");
  const { data: prefs } = await supabase.from("preferences").select("user_id").eq("user_id", user.id).maybeSingle();
  if (prefs) redirect("/dashboard");
  const { data: categories } = await supabase.from("categories").select("id");
  return (
    <div className="public">
      <div className="public-top">
        <Link className="logo" href="/">
          CV Tailor
        </Link>
        <Link href="/dashboard">Dashboard</Link>
      </div>
    <main className="page">
      <div>
        <small className="muted">Step 2 of 2</small>
        <h1>What you're looking for</h1>
        <p className="sub">Four quick answers, and we'll start finding jobs for you.</p>
      </div>
      <OnboardingPreferences
        tz={profile.tz}
        countries={countryOptions()}
        categoryIds={(categories ?? []).map((c) => c.id as string)}
        style={cvStyleOf(profile.cv_style)}
        sample={landingExample()[0]!.resume}
      />
    </main>
    </div>
  );
}
