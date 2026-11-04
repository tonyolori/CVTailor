import Link from "next/link";
import { redirect } from "next/navigation";
import { PreferencesForm } from "@/components/PreferencesForm";
import { countryOptions } from "@/lib/countries";
import { requireUser } from "@/lib/auth";

export default async function OnboardingPreferencesPage() {
  const { supabase, user, profile } = await requireUser();
  if (!profile.consented_at) redirect("/consent");
  const { data: facts } = await supabase.from("fact_library").select("user_id").eq("user_id", user.id).maybeSingle();
  if (!facts) redirect("/onboarding");
  const { data: prefs } = await supabase.from("preferences").select("user_id").eq("user_id", user.id).maybeSingle();
  if (prefs) redirect("/dashboard");
  const { data: categories } = await supabase.from("categories").select("id,label").order("label");
  return (
    <div className="public">
      <div className="public-top">
        <Link className="logo" href="/">
          JobTailor
        </Link>
      </div>
    <main className="page">
      <div>
        <small className="muted">Step 2 of 2</small>
        <h1>What you're looking for</h1>
      </div>
      <PreferencesForm initial={null} categories={categories ?? []} tz={profile.tz} countries={countryOptions()} next="/dashboard" saveLabel="Finish" />
    </main>
    </div>
  );
}
