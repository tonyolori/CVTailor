import { PreferencesSchema } from "@jobtailor/core";
import { AppShell } from "@/components/AppShell";
import { PreferencesForm } from "@/components/PreferencesForm";
import { countryOptions } from "@/lib/countries";
import { requireOnboarded } from "@/lib/auth";

export default async function PreferencesPage() {
  const { supabase, user, profile } = await requireOnboarded();
  const [{ data }, { data: categories }] = await Promise.all([
    supabase.from("preferences").select("data").eq("user_id", user.id).single(),
    supabase.from("categories").select("id,label").order("label"),
  ]);
  return (
    <AppShell supabase={supabase} userId={user.id} email={user.email ?? ""} active="preferences">
      <main className="page">
        <h1>Preferences</h1>
        <PreferencesForm initial={PreferencesSchema.parse(data?.data)} categories={categories ?? []} tz={profile.tz} countries={countryOptions()} />
      </main>
    </AppShell>
  );
}
