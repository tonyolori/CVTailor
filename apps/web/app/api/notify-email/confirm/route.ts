import { NextResponse, type NextRequest } from "next/server";
import { bodyErrorCode, log, logged } from "@/lib/log";
import { CONFIRM_FOR_MS, hashToken } from "@/lib/notify-email";
import { allow, clientIp } from "@/lib/rate-limit";
import { siteUrl } from "@/lib/site";
import { adminClient } from "@/lib/supabase/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function page(body: string, status = 200) {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CV Tailor</title><style>body{font:16px/1.55 Inter,-apple-system,Segoe UI,Roboto,sans-serif;color:#16181d;max-width:460px;margin:64px auto;padding:0 16px}h1{font-size:22px;line-height:1.25}p{color:#4b5060}button{font:inherit;font-weight:600;font-size:14px;min-height:40px;padding:0 20px;border:0;border-radius:8px;background:#1546e0;color:#fff;cursor:pointer}a{color:#1546e0}</style></head><body>${body}</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A page with a button, not an instant change, because mail scanners follow every link in an email. */
export const GET = logged("GET /api/notify-email/confirm", async (request: NextRequest) => {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  if (!UUID.test(token)) return page("<h1>This link isn't valid</h1><p>Enter the address again in your CV Tailor settings to get a new one.</p>", 400);
  return page(
    `<h1>Send your CV Tailor emails here?</h1><p>Your daily job matches will come to this inbox from now on.</p><form method="post"><input type="hidden" name="token" value="${token}"><button type="submit">Confirm this address</button></form>`,
  );
});

export const POST = logged("POST /api/notify-email/confirm", async (request: NextRequest) => {
  if (!allow(`notify-confirm-ip:${clientIp(request.headers)}`, 20, 60_000)) return page("<p>Too many requests. Try again shortly.</p>", 429);
  const form = await request.formData().catch(() => null);
  const token = String(form?.get("token") ?? "");
  if (!UUID.test(token)) return page("<h1>This link isn't valid</h1>", 400);

  const db = adminClient();
  const { data: profile, error } = await db
    .from("profiles")
    .select("id,notify_email_pending,notify_email_sent_at")
    .eq("notify_email_token_hash", hashToken(token))
    .maybeSingle();
  if (error) {
    log("notify_email.lookup_failed", { code: bodyErrorCode(error) }, "error");
    return page("<p>Something went wrong. Please try again.</p>", 500);
  }
  const sentAt = profile?.notify_email_sent_at ? new Date(profile.notify_email_sent_at).getTime() : 0;
  if (!profile?.notify_email_pending || Date.now() - sentAt > CONFIRM_FOR_MS) {
    return page(`<h1>This link has expired</h1><p>It may already have been used, or it's more than 7 days old. Enter the address again in your <a href="${siteUrl("/settings").href}">CV Tailor settings</a> to get a new link.</p>`, 410);
  }

  const address = profile.notify_email_pending as string;
  const { error: saveError } = await db
    .from("profiles")
    .update({ notify_email: address, notify_email_pending: null, notify_email_token_hash: null, notify_email_sent_at: null })
    .eq("id", profile.id);
  if (saveError) {
    log("notify_email.confirm_failed", { userId: profile.id, code: bodyErrorCode(saveError) }, "error");
    return page("<p>Something went wrong. Please try again.</p>", 500);
  }
  log("notify_email.confirmed", { userId: profile.id });
  return page(`<h1>Confirmed</h1><p>Your daily job matches will come to ${escape(address)} from now on.</p><p><a href="${siteUrl("/dashboard").href}">Go to CV Tailor</a></p>`);
});
