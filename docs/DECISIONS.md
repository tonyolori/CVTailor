# Decisions

Choices worth revisiting as CV Tailor grows. Each says what was decided, why, and what should make you look again. Newest first.

## Email: Resend, on its free plan

*Decided 2026-11-16. Prices and limits checked that day.*

**Decision.** Keep Resend for every email: the morning matches, waitlist invitations, welcome emails, run alerts, and Supabase's sign-in links through Resend's SMTP settings. Stay on the free plan until the volume below says otherwise.

**Why not Gmail SMTP, the free alternative.**

- **Cost isn't a reason to switch yet.** Resend's free plan allows 100 emails a day (about 3,000 a month, by third-party counts). Gmail allows about 500 recipients a day.
- **Gmail sends from a personal address.** Every user would see your Gmail address as the sender. Google can suspend an account it thinks is sending automated mail, and that would take your own inbox with it.
- **Resend drops repeat sends; Gmail doesn't.** The worker gives each email an idempotency key, such as `alert-2026-11-16`, and Resend ignores a second send with the same key. The worker runs on a laptop whose network drops when it wakes, so retried sends really happen. Over SMTP, people would get duplicate emails.
- **The code is already written for Resend.** The worker and the web app call Resend's web API with `fetch`. SMTP would need a mail library in both, and a new sender option.

**What it needs.** A domain verified in Resend (SPF and DKIM records, ideally DMARC), with `EMAIL_FROM` set to an address on it. Without a verified domain, Resend won't send to anyone else, and Gmail SMTP becomes the only free choice.

**What uses up the daily 100.**

- One morning email per active user.
- Sign-in links. People can ask for several in a day.
- One invitation and one welcome email per new user.
- Alerts to you, which are rare.

**Look again when any of these happens:**

- **About 70 active users.** Morning emails plus sign-ins then come close to 100 on a busy day. Free-plan sending pauses at the cap; it isn't billed. Paid sending doesn't pause: Resend Pro was about $20 a month for 50,000 emails, then about $0.90 per extra 1,000.
- **Sign-in links start failing or arriving late.** Check Resend's dashboard for the daily cap before anything else.
- **You start taking payments.** Paid users shouldn't miss their morning email over a free-plan cap.
- **You decide not to keep a domain.** Then Gmail SMTP is the fallback, with the drawbacks above. It would mean adding an `smtp` option to `EMAIL_PROVIDER` in the worker and the web app.

**Sources:**

- [Resend: pricing](https://resend.com/docs/knowledge-base/what-is-resend-pricing)
- [Resend: free tier explained](https://automationatlas.io/answers/resend-free-tier-explained-2026/)
- [Gmail SMTP limits](https://serversmtp.com/limits-of-gmail-smtp-server/)
