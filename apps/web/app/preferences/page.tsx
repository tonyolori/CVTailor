import { PreferencesSchema } from "@jobtailor/core";
import { Nav } from "@/components/Nav";
import { PreferencesForm } from "@/components/PreferencesForm";
import { requireOnboarded } from "@/lib/auth";

export default async function PreferencesPage() {
  const { supabase, user, profile } = await requireOnboarded();
  const [{ data }, { data: categories }] = await Promise.all([
    supabase.from("preferences").select("data").eq("user_id", user.id).single(),
    supabase.from("categories").select("id,label").order("label"),
  ]);
  return (
    <>
      <Nav email={user.email ?? ""} />
      <main className="page">
        <h1>Preferences</h1>
        <PreferencesForm initial={PreferencesSchema.parse(data?.data)} categories={categories ?? []} tz={profile.tz} />
      </main>
    </>
  );
}
