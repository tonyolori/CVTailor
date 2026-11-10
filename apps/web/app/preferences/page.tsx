import { cvStyleOf, PreferencesSchema } from "@cvtailor/core";
import { AppShell } from "@/components/AppShell";
import { PreferencesForm } from "@/components/PreferencesForm";
import { ProfileTabs } from "@/components/ProfileTabs";
import { countryOptions } from "@/lib/countries";
import { requireUser } from "@/lib/auth";
import { landingExample } from "@/lib/landing-examples";

export default async function PreferencesPage() {
  const { supabase, user, profile } = await requireUser();
  const [{ data }, { data: categories }] = await Promise.all([
    supabase.from("preferences").select("data").eq("user_id", user.id).maybeSingle(),
    supabase.from("categories").select("id,label").order("label"),
  ]);
  return (
    <AppShell supabase={supabase} userId={user.id} email={user.email ?? ""} active="profile">
      <main className="page">
        <ProfileTabs active="wants" />
        <PreferencesForm
          initial={data ? PreferencesSchema.parse(data.data) : null}
          categories={categories ?? []}
          tz={profile.tz}
          countries={countryOptions()}
          style={cvStyleOf(profile.cv_style)}
          sample={landingExample()[0]!.resume}
        />
      </main>
    </AppShell>
  );
}
