import Link from "next/link";
import { cvStyleOf, FactLibrarySchema } from "@cvtailor/core";
import { AppShell } from "@/components/AppShell";
import { ProfileEditor } from "@/components/ProfileEditor";
import { ProfileTabs } from "@/components/ProfileTabs";
import { requireUser } from "@/lib/auth";

export default async function LibraryPage() {
  const { supabase, user, profile } = await requireUser();
  const { data } = await supabase.from("fact_library").select("data").eq("user_id", user.id).maybeSingle();
  return (
    <AppShell supabase={supabase} userId={user.id} email={user.email ?? ""} active="profile">
      <main className="page pe-page">
        <ProfileTabs active="experience" />
        {data ? (
          <ProfileEditor initial={FactLibrarySchema.parse(data.data)} style={cvStyleOf(profile.cv_style)} />
        ) : (
          <p>
            Nothing here yet. <Link href="/onboarding">Upload your CV</Link> to fill it in.
          </p>
        )}
      </main>
    </AppShell>
  );
}
