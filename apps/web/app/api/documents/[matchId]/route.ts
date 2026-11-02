import { NextResponse, type NextRequest } from "next/server";
import { CoverLetterSchema, ResumeSchema } from "@jobtailor/core";
import { renderCoverLetterPdf, renderResumePdf } from "@jobtailor/render";
import { createClient } from "@/lib/supabase/server";

function filename(name: string, kind: string): string {
  const clean = name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "CV";
  return `${clean}-${kind === "cover_letter" ? "Cover-letter" : "CV"}.pdf`;
}

/**
 * PDF of a saved version. Rendered here rather than fetched, so a user editing at 2pm gets
 * their own edits even when the worker's PC is off. RLS limits the query to the user's rows.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ matchId: string }> }) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const matchId = Number((await params).matchId);
  const kind = request.nextUrl.searchParams.get("kind") === "cover_letter" ? "cover_letter" : "resume";
  const version = request.nextUrl.searchParams.get("version");
  if (!Number.isInteger(matchId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let query = supabase.from("resume_versions").select("json").eq("match_id", matchId).eq("kind", kind);
  if (version) query = query.eq("id", Number(version));
  const { data } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rendered =
    kind === "resume"
      ? await renderResumePdf(ResumeSchema.parse(data.json))
      : await renderCoverLetterPdf(CoverLetterSchema.parse(data.json));
  const name = (data.json as { header?: { name?: string } }).header?.name ?? "CV";
  return new NextResponse(new Uint8Array(rendered.pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename(name, kind))}`,
      "cache-control": "no-store",
    },
  });
}
