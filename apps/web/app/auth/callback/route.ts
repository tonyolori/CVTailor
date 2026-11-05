import { NextResponse, type NextRequest } from "next/server";
import { logged } from "@/lib/log";
import { siteUrl } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";

export const GET = logged("GET /auth/callback", async (request: NextRequest) => {
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(siteUrl("/dashboard", request));
  }
  return NextResponse.redirect(siteUrl("/login?error=link", request));
});
