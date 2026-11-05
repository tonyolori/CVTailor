import { NextResponse, type NextRequest } from "next/server";
import { logged } from "@/lib/log";
import { allow, clientIp } from "@/lib/rate-limit";
import { adminClient } from "@/lib/supabase/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function page(body: string, status = 200) {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CV Tailor</title><style>:root{color-scheme:light dark}body{font:16px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;max-width:460px;margin:48px auto;padding:0 16px}button{font:inherit;font-weight:600;padding:8px 14px;border-radius:8px;cursor:pointer}</style></head><body>${body}</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

/** A page with a button, not an instant pause, because mail scanners follow every link in an email. */
export const GET = logged("GET /api/unsubscribe", async (request: NextRequest) => {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  if (!UUID.test(token)) return page("<p>This link isn't valid.</p>", 400);
  return page(`<h1>Pause these emails?</h1><p>Your matches stay on your dashboard, and you can turn email back on in your settings.</p><form method="post"><input type="hidden" name="token" value="${token}"><button type="submit">Pause emails</button></form>`);
});

/** Also serves one-click List-Unsubscribe, which POSTs to the URL in the header. */
export const POST = logged("POST /api/unsubscribe", async (request: NextRequest) => {
  if (!allow(`unsub:${clientIp(request.headers)}`, 20, 60_000)) return page("<p>Too many requests. Try again shortly.</p>", 429);
  const fromQuery = request.nextUrl.searchParams.get("token");
  const form = fromQuery ? null : await request.formData().catch(() => null);
  const token = fromQuery ?? String(form?.get("token") ?? "");
  if (!UUID.test(token)) return page("<p>This link isn't valid.</p>", 400);
  const { error } = await adminClient().from("profiles").update({ email_paused: true }).eq("unsubscribe_token", token);
  if (error) return page("<p>Something went wrong. Please try again.</p>", 500);
  return page("<h1>Emails paused</h1><p>You won't get the daily email. You can turn it back on in your settings.</p>");
});
