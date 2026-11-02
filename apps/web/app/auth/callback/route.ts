import { NextResponse, type NextRequest } from "next/server";
import { siteUrl } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(siteUrl("/dashboard", request));
  }
  return NextResponse.redirect(siteUrl("/login", request));
}
