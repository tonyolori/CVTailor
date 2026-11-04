import { NextResponse, type NextRequest } from "next/server";
import { loadMatchDetail } from "@/lib/match-detail";
import { createClient } from "@/lib/supabase/server";

/** The CV and posting for one of the user's own matches. RLS keeps other people's out of reach. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const detail = await loadMatchDetail(supabase, id);
  if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(detail, { headers: { "cache-control": "no-store" } });
}
