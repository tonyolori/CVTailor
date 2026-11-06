import { inviteEmail, signInLinkEmail, signUpLinkEmail, welcomeEmail } from "@cvtailor/core/email";
import { log } from "../log";
import { mailpitSender } from "./send";
import { DailySummarySchema, emailSubject, renderEmailHtml, renderEmailText } from "./template";

/*
Sends every email to local Supabase's Mailpit, with made-up content, so a design change can be
seen as an inbox shows it. Each run replaces the last one's previews.
  npm run email:preview          once
  npm run email:preview:watch    again on every save
*/
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const SITE = "http://127.0.0.1:3000";
const FROM = process.env.EMAIL_FROM ?? "CV Tailor <hello@example.com>";
const TO = "preview@cvtailor.test";
const TAG = "preview";

const digest = DailySummarySchema.parse({
  date: new Date().toISOString().slice(0, 10),
  sources: [
    { label: "Himalayas", url: "https://himalayas.app" },
    { label: "Remote OK", url: "https://remoteok.com" },
  ],
  gaps: ["No job source covers on-site roles in your field in Leeds yet."],
  roles: [
    {
      matchId: 1,
      title: "Finance Manager",
      company: "Northwind Health",
      score: 9,
      apply: `${SITE}/dashboard`,
      sourceLabel: "Himalayas",
      sourceUrl: "https://himalayas.app",
      location: "Hybrid, London",
      verified: "Open at its source this morning",
      why: "Seven years of month-end close, and you led two audits.",
    },
    {
      matchId: 2,
      title: "Senior Accountant",
      company: "Bramble & Co",
      score: 8,
      tier: "a",
      apply: `${SITE}/dashboard`,
      location: "London",
      verified: "Couldn't reach the posting",
      verifiedOk: false,
      why: "IFRS reporting matches your last role.",
      note: "The posting asks applicants to put a reference number in the subject line.",
    },
  ],
  worthALook: [
    { title: "Group Controller", company: "Larch Partners", score: 8, link: `${SITE}/dashboard`, location: "On-site, Leeds", posted: "2 days ago", sourceLabel: "Remote OK", why: "Strong fit on scope and team size.", whyNot: "Outside the places you chose." },
  ],
  closeCalls: [{ company: "Fenwick", title: "Accountant", reason: "Posted 24 days ago", link: `${SITE}/dashboard` }],
  failed: [{ company: "Osprey Labs", title: "Finance Lead", reason: "The CV named a qualification that isn't in your library.", link: `${SITE}/dashboard` }],
});

async function main(): Promise<void> {
  // Clears the last run's previews, so the inbox shows only the current design.
  await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`tag:${TAG}`)}`, { method: "DELETE" });

  const sender = mailpitSender(MAILPIT, fetch, [TAG]);
  const filled = ({ subject, html }: { subject: string; html: string }) => ({
    subject,
    html: html.replaceAll("{{ .ConfirmationURL }}", `${SITE}/login`).replaceAll("{{ .SiteURL }}", SITE),
    text: "",
  });
  const links = { dashboardUrl: `${SITE}/dashboard`, unsubscribeUrl: `${SITE}/api/unsubscribe?token=preview` };
  const emails = [
    filled(signInLinkEmail()),
    filled(signUpLinkEmail()),
    inviteEmail({ signInUrl: `${SITE}/login`, homeUrl: `${SITE}/` }),
    welcomeEmail({ setupUrl: `${SITE}/onboarding`, homeUrl: `${SITE}/`, privacyUrl: `${SITE}/privacy`, freeCvs: 3, canReply: true }),
    { subject: emailSubject(digest), html: renderEmailHtml(digest, links), text: renderEmailText(digest, links) },
  ];
  for (const e of emails) await sender.send({ to: TO, from: FROM, ...e });
  log("email.preview_sent", { count: emails.length });
}

main().catch((err) => {
  log("email.preview_failed", { name: err instanceof Error ? err.name : "unknown" }, "error");
  process.exitCode = 1;
});
