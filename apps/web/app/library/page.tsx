import { FactLibrarySchema } from "@cvtailor/core";
import { AppShell } from "@/components/AppShell";
import { LibraryEditor } from "@/components/LibraryEditor";
import { requireOnboarded } from "@/lib/auth";

export default async function LibraryPage() {
  const { supabase, user } = await requireOnboarded();
  const { data } = await supabase.from("fact_library").select("data").eq("user_id", user.id).single();
  const lib = FactLibrarySchema.parse(data?.data);
  return (
    <AppShell supabase={supabase} userId={user.id} email={user.email ?? ""} active="library">
      <main className="page">
        <div>
          <h1>Your library</h1>
          <p className="muted">Everything a CV can say about you. The more complete and accurate this is, the better every CV gets.</p>
        </div>
        <LibraryEditor initial={lib} />
      </main>
    </AppShell>
  );
}
