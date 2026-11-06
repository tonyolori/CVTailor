import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bodyErrorCode } from "@cvtailor/core/log";
import { log } from "../log";

export interface OutgoingEmail {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  attachments?: { filename: string; content: Buffer }[];
  /** Same key, same email: a retried send can't deliver twice. */
  idempotencyKey?: string;
}

export interface EmailSender {
  send(email: OutgoingEmail): Promise<{ id: string }>;
}

/** Docs: resend.com/docs/api-reference/emails/send-email */
export function resendSender(apiKey: string, fetchFn: typeof fetch = fetch): EmailSender {
  return {
    async send(email) {
      const res = await fetchFn("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(email.idempotencyKey ? { "Idempotency-Key": email.idempotencyKey } : {}),
        },
        body: JSON.stringify({
          from: email.from,
          to: email.to,
          subject: email.subject,
          html: email.html,
          text: email.text,
          headers: email.headers,
          attachments: email.attachments?.map((a) => ({ filename: a.filename, content: a.content.toString("base64") })),
        }),
      });
      if (!res.ok) {
        log("email.refused", { status: res.status, code: bodyErrorCode(await res.clone().json().catch(() => null)) }, "error");
        throw new Error(`Resend answered ${res.status}`);
      }
      return { id: ((await res.json()) as { id: string }).id };
    },
  };
}

/** "CV Tailor <hello@x.com>" as its parts. */
export function parseAddress(address: string): { Email: string; Name?: string } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(address);
  return m ? { Email: m[2]!, ...(m[1] ? { Name: m[1].replace(/^"|"$/g, "") } : {}) } : { Email: address.trim() };
}

/** Local Supabase's Mailpit, for seeing emails as an inbox shows them. Docs: mailpit.axllent.org/docs/api-v1/ */
export function mailpitSender(baseUrl: string, fetchFn: typeof fetch = fetch, tags: string[] = []): EmailSender {
  return {
    async send(email) {
      const res = await fetchFn(`${baseUrl}/api/v1/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          From: parseAddress(email.from),
          To: [parseAddress(email.to)],
          Subject: email.subject,
          HTML: email.html,
          Text: email.text,
          Headers: email.headers,
          Tags: tags,
          Attachments: email.attachments?.map((a) => ({ Filename: a.filename, Content: a.content.toString("base64") })),
        }),
      });
      if (!res.ok) {
        log("email.refused", { status: res.status }, "error");
        throw new Error(`Mailpit answered ${res.status}`);
      }
      return { id: ((await res.json()) as { ID: string }).ID };
    },
  };
}

/** Writes to .local/outbox, for inspecting emails without an account. */
export function fileSender(dir: string): EmailSender {
  return {
    async send(email) {
      mkdirSync(dir, { recursive: true });
      const id = `${Date.now()}-${(email.idempotencyKey ?? "email").replace(/[^a-z0-9-]/gi, "_")}`;
      writeFileSync(join(dir, `${id}.html`), email.html);
      writeFileSync(join(dir, `${id}.txt`), `To: ${email.to}\nSubject: ${email.subject}\nAttachments: ${(email.attachments ?? []).map((a) => a.filename).join(", ")}\n\n${email.text}`);
      for (const a of email.attachments ?? []) writeFileSync(join(dir, `${id}-${a.filename}`), a.content);
      return { id };
    },
  };
}
