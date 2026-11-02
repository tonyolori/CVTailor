import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
      if (!res.ok) throw new Error(`Resend answered ${res.status}`);
      return { id: ((await res.json()) as { id: string }).id };
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
