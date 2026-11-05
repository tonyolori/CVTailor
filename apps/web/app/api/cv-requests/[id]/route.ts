import { NextResponse, type NextRequest } from "next/server";
import { expireCvRequests } from "@cvtailor/ai/cv-request";
import { logged } from "@/lib/log";
import { adminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/** Where the user's own CV request has got to. RLS keeps other people's out of reach. */
export const GET = logged("GET /api/cv-requests/[id]", async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const id = Number((await params).id);
  const read = () => supabase.from("cv_requests").select("status,error,created_at").eq("id", id).maybeSingle();
  let { data } = await read();
  if (!data) return NextResponse.json({ status: "failed", error: "Not found" }, { status: 404 });
  // One cut off with its function would otherwise say "running" for good.
  if (data.status === "running" && Date.now() - new Date(data.created_at).getTime() > 10 * 60_000) {
    await expireCvRequests(adminClient(), auth.user.id);
    data = (await read()).data ?? data;
  }
  return NextResponse.json({ status: data.status, error: data.error }, { headers: { "cache-control": "no-store" } });
});
