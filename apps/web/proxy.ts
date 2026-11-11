import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { log, loggedFetch } from "./lib/log";
import { siteUrl } from "./lib/site";

const PUBLIC_PATHS = ["/login", "/waitlist", "/auth", "/privacy", "/pricing", "/api/unsubscribe", "/api/webhooks", "/api/cron", "/api/review-notes"];

/** Refreshes the session cookie on each request and sends signed-out visitors to the login page. */
export async function proxy(request: NextRequest) {
  // Locally, sign-in links return to 127.0.0.1, and a login started on localhost has its
  // cookie under the wrong host, so it fails. The Host header is what the browser really used.
  // Not a redirect response: Next sees both names as this server and rewrites it back to localhost.
  const site = siteUrl("/", request);
  if (site.hostname === "127.0.0.1" && request.headers.get("host")?.split(":")[0] === "localhost") {
    const target = siteUrl(request.nextUrl.pathname + request.nextUrl.search, request).href;
    return new NextResponse(`<!doctype html><meta http-equiv="refresh" content="0;url=${target}">`, { headers: { "content-type": "text/html" } });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { fetch: loggedFetch },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(toSet) {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data, error } = await supabase.auth.getClaims();
  const path = request.nextUrl.pathname;
  // The path only: query strings can hold sign-in codes and unsubscribe tokens.
  log("request", { method: request.method, path, signedIn: Boolean(data?.claims), action: request.headers.has("next-action") });
  if (error && error.name !== "AuthSessionMissingError") log("auth.claims_failed", { errorType: error.name, code: error.code, status: error.status }, "warn");
  const isPublic = path === "/" || PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
  if (!data?.claims && !isPublic) {
    log("request.signed_out", { method: request.method, path });
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    return NextResponse.redirect(siteUrl("/login", request));
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png).*)"],
};
