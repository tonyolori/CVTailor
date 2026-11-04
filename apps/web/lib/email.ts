import "server-only";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { siteUrl } from "./site";

/** The invitation someone on the waitlist receives. Same provider settings as the worker's email. */
export async function sendInvite(email: string): Promise<boolean> {
  const link = siteUrl("/login").href;
  const subject = "You're invited to JobTailor";
  const text = `You're in.\n\nYour place on JobTailor is ready. Sign in with this email address:\n${link}\n\nWe'll email you a link, so there's no password to remember.`;
  const html = `<p>You're in.</p><p>Your place on JobTailor is ready. <a href="${link}">Sign in with this email address</a>.</p><p>We'll email you a link, so there's no password to remember.</p>`;
  const from = process.env.EMAIL_FROM ?? "JobTailor <hello@example.com>";

  if (process.env.EMAIL_PROVIDER === "resend" && process.env.EMAIL_API_KEY) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.EMAIL_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `invite-${email}` },
      body: JSON.stringify({ from, to: email, subject, html, text }),
    }).catch(() => null);
    return Boolean(res?.ok);
  }

  // Local development: the same outbox folder the worker writes to.
  try {
    const dir = join(process.cwd(), "../../.local/outbox");
    mkdirSync(dir, { recursive: true });
    const id = `${Date.now()}-invite`;
    writeFileSync(join(dir, `${id}.html`), html);
    writeFileSync(join(dir, `${id}.txt`), `To: ${email}\nSubject: ${subject}\n\n${text}`);
    return true;
  } catch {
    return false;
  }
}
