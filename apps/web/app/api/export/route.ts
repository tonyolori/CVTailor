import { strToU8, zipSync } from "fflate";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Everything held about the user: JSON and PDFs in one zip. Uses their own session, so RLS scopes it. */
export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const id = auth.user.id;

  const [profile, preferences, facts, matches, versions, documents, summaries, payments, subscriptions, pastedJobs] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", id).single(),
    supabase.from("preferences").select("data,updated_at").eq("user_id", id).maybeSingle(),
    supabase.from("fact_library").select("data,updated_at").eq("user_id", id).maybeSingle(),
    supabase.from("matches").select("*,jobs(title,company,url)").eq("user_id", id),
    supabase.from("resume_versions").select("*").eq("user_id", id),
    supabase.from("documents").select("*").eq("user_id", id),
    supabase.from("daily_summaries").select("run_date,data,status,sent_at").eq("user_id", id),
    supabase.from("payments").select("*").eq("user_id", id),
    supabase.from("subscriptions").select("*").eq("user_id", id),
    supabase.from("jobs").select("id,title,company,apply_url,raw_text,first_seen").eq("owner_id", id),
  ]);

  const dump = {
    exported_at: new Date().toISOString(),
    profile: profile.data,
    preferences: preferences.data,
    fact_library: facts.data,
    matches: matches.data,
    resume_versions: versions.data,
    documents: documents.data,
    daily_summaries: summaries.data,
    payments: payments.data,
    subscriptions: subscriptions.data,
    pasted_jobs: pastedJobs.data,
  };

  const files: Record<string, Uint8Array> = { "jobtailor-data.json": strToU8(JSON.stringify(dump, null, 2)) };
  for (const d of documents.data ?? []) {
    const { data } = await supabase.storage.from("documents").download(d.storage_path);
    if (data) files[`pdfs/${d.storage_path.split("/").slice(1).join("-")}`] = new Uint8Array(await data.arrayBuffer());
  }
  const zip = zipSync(files);
  return new NextResponse(zip.buffer as ArrayBuffer, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": 'attachment; filename="jobtailor-export.zip"',
      "cache-control": "no-store",
    },
  });
}
