import "server-only";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { confirmAddressEmail, inviteEmail, welcomeEmail } from "@cvtailor/core/email";
import { errorFields, log, loggedFetch } from "./log";
import { cvCounts } from "./plan-settings";
import { siteUrl } from "./site";

interface Outgoing {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Same key, same email: a retried send can't deliver twice. */
  idempotencyKey: string;
}

/** Same provider settings as the worker's email. */
async function send(email: Outgoing): Promise<boolean> {
  const from = process.env.EMAIL_FROM ?? "CV Tailor <hello@example.com>";
  const replyTo = process.env.EMAIL_REPLY_TO || undefined;

  if (process.env.EMAIL_PROVIDER === "resend" && process.env.EMAIL_API_KEY) {
    const res = await loggedFetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.EMAIL_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": email.idempotencyKey },
      body: JSON.stringify({ from, to: email.to, reply_to: replyTo, subject: email.subject, html: email.html, text: email.text }),
    }).catch(() => null);
    return Boolean(res?.ok);
  }

  // Local Supabase's Mailpit, to see the email as an inbox shows it.
  if (process.env.EMAIL_PROVIDER === "mailpit") {
    const address = (a: string) => {
      const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(a);
      return m ? { Email: m[2], Name: m[1] || undefined } : { Email: a.trim() };
    };
    const res = await loggedFetch(`${process.env.MAILPIT_URL ?? "http://127.0.0.1:54324"}/api/v1/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ From: address(from), To: [address(email.to)], ReplyTo: replyTo ? [address(replyTo)] : [], Subject: email.subject, HTML: email.html, Text: email.text }),
    }).catch(() => null);
    return Boolean(res?.ok);
  }

  // Local development: the same outbox folder the worker writes to.
  try {
    const dir = join(process.cwd(), "../../.local/outbox");
    mkdirSync(dir, { recursive: true });
    const id = `${Date.now()}-${email.idempotencyKey.replace(/[^a-z0-9-]/gi, "_")}`;
    writeFileSync(join(dir, `${id}.html`), email.html);
    writeFileSync(join(dir, `${id}.txt`), `To: ${email.to}\nSubject: ${email.subject}\n\n${email.text}`);
    return true;
  } catch (err) {
    log("email.outbox_failed", errorFields(err), "error");
    return false;
  }
}

/** The invitation someone on the waitlist receives. */
export async function sendInvite(email: string): Promise<boolean> {
  const message = inviteEmail({ signInUrl: siteUrl("/login").href, homeUrl: siteUrl("/").href });
  return send({ to: email, ...message, idempotencyKey: `invite-${email}` });
}

/** Sent once, when someone first agrees to the terms and their account starts. */
export async function sendWelcome(userId: string, email: string): Promise<boolean> {
  const message = welcomeEmail({
    setupUrl: siteUrl("/onboarding").href,
    homeUrl: siteUrl("/").href,
    privacyUrl: siteUrl("/privacy").href,
    freeCvs: cvCounts().free,
    canReply: Boolean(process.env.EMAIL_REPLY_TO),
  });
  return send({ to: email, ...message, idempotencyKey: `welcome-${userId}` });
}

/** Asks a new address for the daily email to confirm it's wanted there. The token is only in the link. */
export async function sendAddressConfirmation(to: string, token: string): Promise<boolean> {
  const confirmUrl = siteUrl(`/api/notify-email/confirm?token=${encodeURIComponent(token)}`).href;
  const message = confirmAddressEmail({ confirmUrl, homeUrl: siteUrl("/").href });
  return send({ to, ...message, idempotencyKey: `confirm-address-${token}` });
}
