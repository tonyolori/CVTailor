import Link from "next/link";
import { FactLibrarySchema } from "@cvtailor/core";
import { AppShell } from "@/components/AppShell";
import { LibraryEditor } from "@/components/LibraryEditor";
import { requireUser } from "@/lib/auth";

export default async function LibraryPage() {
  const { supabase, user } = await requireUser();
  const { data } = await supabase.from("fact_library").select("data").eq("user_id", user.id).maybeSingle();
  return (
    <AppShell supabase={supabase} userId={user.id} email={user.email ?? ""} active="library">
      <main className="page">
        <div>
          <h1>Your library</h1>
          <p className="muted">Everything a CV can say about you. The more complete and accurate this is, the better every CV gets.</p>
        </div>
        {data ? (
          <LibraryEditor initial={FactLibrarySchema.parse(data.data)} />
        ) : (
          <p>
            Your library is empty. <Link href="/onboarding">Upload your CV</Link> to fill it in.
          </p>
        )}
      </main>
    </AppShell>
  );
}
