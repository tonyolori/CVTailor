import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Status of the user's own AI task. RLS keeps other people's out of reach. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data } = await supabase.from("ai_tasks").select("status,output,error").eq("id", Number((await params).id)).maybeSingle();
  if (!data) return NextResponse.json({ status: "failed", error: "Not found" }, { status: 404 });
  return NextResponse.json(data);
}
