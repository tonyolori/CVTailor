import { NextResponse, type NextRequest } from "next/server";
import { cvStyleOf, ResumeSchema } from "@jobtailor/core";
import { renderResumePdf } from "@jobtailor/render";
import { createClient } from "@/lib/supabase/server";

/** Live preview for the editor. Renders what it's sent and stores nothing. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const parsed = ResumeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid CV" }, { status: 400 });
  const { pdf, pages } = await renderResumePdf(parsed.data, cvStyleOf(request.nextUrl.searchParams.get("style")));
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": "inline", "x-pdf-pages": String(pages), "cache-control": "no-store" },
  });
}
