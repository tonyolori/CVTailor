import Link from "next/link";
import { FactLibrarySchema } from "@cvtailor/core";
import { AppShell } from "@/components/AppShell";
import { LibraryEditor } from "@/components/LibraryEditor";
import { ProfileTabs } from "@/components/ProfileTabs";
import { requireUser } from "@/lib/auth";

export default async function LibraryPage() {
  const { supabase, user } = await requireUser();
  const { data } = await supabase.from("fact_library").select("data").eq("user_id", user.id).maybeSingle();
  return (
    <AppShell supabase={supabase} userId={user.id} email={user.email ?? ""} active="profile">
      <main className="page">
        <ProfileTabs active="experience" />
        <p className="muted">Everything a CV can say about you. The more complete and accurate this is, the better every CV gets.</p>
        {data ? (
          <LibraryEditor initial={FactLibrarySchema.parse(data.data)} />
        ) : (
          <p>
            Nothing here yet. <Link href="/onboarding">Upload your CV</Link> to fill it in.
          </p>
        )}
      </main>
    </AppShell>
  );
}
