import { errorInfo, must, type Db } from "../db";
import { DailySummarySchema, emailSubject, renderEmailHtml, renderEmailText } from "../email/template";
import type { EmailSender } from "../email/send";
import { log } from "../log";

export interface DeliverDeps {
  db: Db;
  sender: EmailSender;
  from: string;
  siteUrl: string;
}

interface DueRow {
  user_id: string;
  run_date: string;
  data: unknown;
}

interface ProfileForEmail {
  id: string;
  email: string;
  notify_email: string | null;
  email_paused: boolean;
  unsubscribe_token: string;
}

function filename(company: string, kind: string): string {
  const clean = company.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 50) || "role";
  return `${kind}-${clean}.pdf`;
}

/** Sends each email at or after its send_at. A send that fails stays pending for the next pass, up to a day late. */
export async function sendDueEmails(deps: DeliverDeps, now: Date = new Date()): Promise<{ sent: number; skipped: number; failed: number }> {
  const due = must(
    await deps.db.from("daily_summaries").select("user_id,run_date,data").eq("status", "pending").lte("send_at", now.toISOString()).limit(100),
    "due emails",
  ) as DueRow[];
  const out = { sent: 0, skipped: 0, failed: 0 };
  if (due.length === 0) return out;

  const profiles = must(
    await deps.db.from("profiles").select("id,email,notify_email,email_paused,unsubscribe_token").in("id", due.map((d) => d.user_id)),
    "email profiles",
  ) as ProfileForEmail[];

  for (const row of due) {
    const profile = profiles.find((p) => p.id === row.user_id);
    const mark = async (fields: Record<string, unknown>) =>
      must(await deps.db.from("daily_summaries").update(fields).eq("user_id", row.user_id).eq("run_date", row.run_date), "mark email");

    if (!profile || profile.email_paused) {
      await mark({ status: "skipped" });
      out.skipped++;
      continue;
    }
    try {
      const summary = DailySummarySchema.parse(row.data);
      const links = {
        dashboardUrl: `${deps.siteUrl}/dashboard`,
        unsubscribeUrl: `${deps.siteUrl}/api/unsubscribe?token=${profile.unsubscribe_token}`,
      };
      const attachments: { filename: string; content: Buffer }[] = [];
      for (const role of summary.roles) {
        for (const [path, kind] of [
          [role.resumePath, "CV"],
          [role.coverLetterPath, "Cover-letter"],
        ] as const) {
          if (!path) continue;
          const { data, error } = await deps.db.storage.from("documents").download(path);
          if (error || !data) throw new Error(`download: ${error?.message ?? "empty"}`);
          attachments.push({ filename: filename(role.company, kind), content: Buffer.from(await data.arrayBuffer()) });
        }
      }
      const res = await deps.sender.send({
        to: profile.notify_email ?? profile.email,
        from: deps.from,
        subject: emailSubject(summary),
        html: renderEmailHtml(summary, links),
        text: renderEmailText(summary, links),
        headers: { "List-Unsubscribe": `<${links.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        attachments,
        idempotencyKey: `daily-${row.user_id}-${row.run_date}`,
      });
      await mark({ status: "sent", sent_at: new Date().toISOString(), provider_message_id: res.id, error: null });
      log("email.sent", { userId: row.user_id, runDate: row.run_date, attachments: attachments.length });
      out.sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message.slice(0, 200) : "send failed";
      log("email.failed", { userId: row.user_id, runDate: row.run_date, ...errorInfo(err) }, "error");
      const age = now.getTime() - new Date(`${row.run_date}T00:00:00Z`).getTime();
      await mark(age > 36 * 3_600_000 ? { status: "failed", error: message } : { error: message });
      out.failed++;
    }
  }
  return out;
}
