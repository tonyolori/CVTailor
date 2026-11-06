# Setup checklist

Things only Tony can do. Items are ordered so you can stop at any point and still have a working system at that level.

## Level 1: local development (no accounts)

- [ ] Docker Desktop running.
- [ ] `npm install`
- [ ] `npx supabase start` (first run downloads images). Copy the printed keys into `.env` using `.env.example`.
- [ ] `npm run db:reset` applies migrations and `supabase/seed.sql`.
- [ ] `npm run seed` creates the three synthetic test users, loads the employer boards to scan, and adds you from `private/owner.json`. That file is gitignored, so copy it across yourself on a new machine.
- [ ] `npm test`, `npm run test:rls` and `npm run test:integration`. The last two wipe local data, so re-run the seeds afterwards.

## Level 2: your Claude account, no API key (just you and the synthetic personas)

- [ ] Be on a paid Claude plan. Pro, Max or Ultra all work; heavier plans give more room, because these runs draw from your normal subscription limits.
- [ ] Sign in: `npm run claude:login` runs the Claude Code binary's login. It completes in Anthropic's own browser flow.
- [ ] In `.env`: `LLM_PROVIDER=claude-subscription` and `OWNER_EMAIL=<your account email in CV Tailor>`.
- [ ] Check it: `npm run llm:check`
- [ ] Do **not** set `ANTHROPIC_API_KEY` in this mode. It's ignored for AI calls here, but it's easy to mistake for what's being billed.
- [ ] If runs stop early with a usage-limit note, lower `ENRICH_MAX_PER_RUN` or `daily_cap`, or run at a quieter time. The next run picks up where it stopped.

**Limits of this mode.** It is for your own testing. Anthropic's terms do not allow routing requests through a personal plan on behalf of other people, so the worker runs AI stages only for `OWNER_EMAIL` and synthetic personas. Real test users need Level 3 or 3b.

## Level 3: API key (any invited user)

- [ ] Create a key in the [Claude Console](https://platform.claude.com/).
- [ ] **Set a monthly spend limit in the Console** before using it. This is the only hard ceiling; the app's budgets are a second line of defence.
- [ ] In `.env`: `LLM_PROVIDER=anthropic-api`, `ANTHROPIC_API_KEY=...`
- [ ] `npm run llm:check`, then `npm run eval:enrich -- --limit 10` to see real costs.

Max, Ultra and Team plans include monthly API credits for a linked Console org ([details](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)). Check whether yours does before paying separately.

## Level 3b: DeepSeek API key (any invited user)

An alternative to Level 3. It's cheaper for CVs, but dearer for enrichment and scoring than Haiku with the Batch API.

**Before inviting anyone on this level:**

- [ ] Understand where the data goes. CV uploads, each person's full fact library (name, phone and email included) and their preferences are sent to DeepSeek. Its [privacy policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html) says it stores data in China and lists model training as a use, but says apps built on its platform aren't covered. Its [platform terms](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html) don't say where API data is kept or whether it's used for training, and mention no data processing agreement.
- [ ] Ask `privacy@deepseek.com` to confirm in writing how API data is handled, and to opt your account out of training.
- [ ] **TODO(verify): get legal advice on the transfer.** The NDPA 2023 (sections 41 to 43) and the 2025 GAID set conditions for sending personal data abroad, and commentary says the GAID requires an impact assessment first. I only found secondary summaries of these, not the text.
- [ ] Tell test users plainly. The privacy page and consent screen name DeepSeek, but anyone who consented before they did hasn't agreed to this.

**Then:**

- [ ] Create a key on the [DeepSeek platform](https://platform.deepseek.com/) and add a small prepaid balance. That balance is your hard ceiling; when it runs out, stages stop and resume on the next run.
- [ ] In `.env`: `LLM_PROVIDER=deepseek`, `DEEPSEEK_API_KEY=...`, `LLM_MODEL_SMALL=deepseek-flash`, `LLM_MODEL_STRONG=deepseek-v4-pro`.
- [ ] Set `RUN_START_HOUR_UTC=4`. The default of 1 lands in DeepSeek's peak hours, weekdays 01:00-04:00 and 06:00-10:00 UTC, which cost double. A run still going at 06:00 may trigger the late-run alert.
- [ ] `npm run llm:check`, then `npm run eval:enrich -- --limit 10`. **Compare the results with Claude's before relying on it**, and check a few CVs by hand. The prompts were written for Claude.

To switch back, put the Level 2 or Level 3 values back and restart the worker. Nothing else depends on the provider.

## Level 4: cloud (dashboard reachable from anywhere)

### Supabase
- [ ] Create a free project.
- [ ] `npx supabase link --project-ref <ref>`, then `npx supabase db push`.
- [ ] Dashboard > Authentication > Hooks: enable **Before User Created**, Postgres function `public.hook_before_user_created`.
- [ ] Dashboard > Authentication > URL configuration: set the site URL to your web app's URL and add `<site>/auth/callback` to the redirect list.
- [ ] Add yourself to the allow-list: `insert into public.allowed_emails (email) values ('<you>');`
- [ ] Copy the URL, anon key and service-role key into the worker `.env` and the web host. **The service-role key goes only on the worker and in server-side web env. Never in a `NEXT_PUBLIC_` variable.**
- [ ] Set `admin_emails` in `app_settings`: `update public.app_settings set value = '["<you>"]' where key = 'admin_emails';`

### Domain and Resend
- [ ] Buy or choose a domain.
- [ ] Create a Resend account, add the domain, and add the DNS records it shows (SPF, DKIM, and ideally DMARC).
- [ ] Put the key in `EMAIL_API_KEY` and set `EMAIL_FROM` to an address on that domain.
- [ ] Point Supabase Auth's SMTP at Resend (Dashboard > Authentication > SMTP), or magic links are limited by Supabase's built-in sender.
- [ ] Give the sign-in emails the CV Tailor design, in Dashboard > Authentication > Emails. **Confirm signup** is the first email a new person gets: set its subject to `Confirm your email to join CV Tailor` and its body to `supabase/templates/confirmation.html`. **Magic link** is every sign-in after that: subject `Your CV Tailor sign-in link`, body `supabase/templates/magic_link.html`. After changing the design, run `npm run email:auth-templates` and paste them in again.

### Web host (Vercel or Cloudflare Pages)
- [ ] Create a project with `apps/web` as its root and add the env vars listed in `.env.example` under "Web app".
- [ ] Set `NEXT_PUBLIC_SITE_URL` to the deployed URL. Sign-in redirects depend on it.
- [ ] Run the web app's functions in the Supabase project's region. Every page makes several database calls, one after another, and each crosses the distance between the two. `apps/web/vercel.json` sets `dub1` (Dublin), [Vercel's region for AWS eu-west-1](https://vercel.com/docs/regions#region-list), where the CVTailor project is. If the Supabase project ever moves, change it to match. Vercel's default is Washington, D.C. (`iad1`).
- [ ] Set `CRON_SECRET`, `OWNER_EMAIL`, `EMAIL_API_KEY` and `EMAIL_FROM`. The daily check in `apps/web/vercel.json` uses them to alert you when no run has finished. On Cloudflare Pages, call `/api/cron/run-check` from a Cron Trigger instead.
- [ ] Set `SUPABASE_SERVICE_ROLE_KEY` as a server-only variable. Account deletion, unsubscribe, webhooks and admin use it.
- [ ] Set the AI provider on the web host too, because it writes CVs and reads uploads as people ask: `LLM_PROVIDER`, its key (`DEEPSEEK_API_KEY` at Level 3b, `ANTHROPIC_API_KEY` at Level 3), `LLM_MODEL_SMALL`, `LLM_MODEL_STRONG`, `GLOBAL_DAILY_BUDGET_USD` and `USER_DAILY_BUDGET_USD`. Use the same values as the worker: both count against one daily budget. Without a key, people can still onboard by hand but can't get CVs.
- [ ] Writing a CV runs for up to 300 seconds after the request, the most the Hobby plan allows. If CVs time out, Pro allows longer: raise `maxDuration` in `apps/web/app/api/cv-requests/route.ts`.
- [ ] On Vercel, use the **Pro plan once you take payments**. [Hobby is for non-commercial use only](https://vercel.com/docs/limits/fair-use-guidelines), and requesting payment from visitors counts as commercial.
- [ ] Vercel runs only the web app. The worker has to run somewhere that stays on, as below.

### Worker on your PC
- [ ] Follow `docs/SCHEDULING.md` to keep it running on your Mac.

## Level 5: paid plans

Matches are free for everyone. Once billing is on, each CV uses one from the person's allowance: 3 free to try it, 30 with a plan, and 10 more in each top-up. A CV that can't be written is given back. Until billing is on, nothing is counted. Change those numbers with `FREE_CVS`, `CVS_PER_PLAN` and `CVS_PER_TOP_UP`. A change applies to the next signup or payment, not to CVs people already have.

- [ ] Create a Paystack account and complete its business verification.
- [ ] Set the webhook URL to `<site>/api/webhooks/paystack`.
- [ ] Create a monthly plan in Paystack. Put its code in `PAYSTACK_PLAN_CODE_MONTHLY`, and set `PAYSTACK_SECRET_KEY`, `PRICE_MONTHLY_NAIRA`, `PRICE_PASS_NAIRA` and `PRICE_TOP_UP_NAIRA` on the web host. Prices are in naira, so 5000 means ₦5,000. Keep the monthly price the same as the plan you created in Paystack.
- [ ] **TODO(verify): Paystack's docs block automated reading, so I couldn't read them directly.** The signature scheme is confirmed. Event names and payload fields come from secondary sources, so send test events from the Paystack dashboard and confirm `apps/web/lib/paystack.ts` handles them, using test keys, before taking real money.
- [ ] Make one real test-mode checkout for each plan and a top-up, and check that Settings shows the new CVs. A redirect back from Paystack proves nothing: only the webhook grants a plan.
- [ ] Decide pricing using cost per user per day on the admin page.
- [ ] Set `CV_REQUESTS_PER_DAY` on the web host and the worker. It's a safeguard against abuse, on top of the allowance, and it defaults to 7.
- [ ] Set `BILLING_ENFORCED=true` on **both the web host and the worker** when you're ready. This also turns off Remotive, whose free API excludes commercial use.

## Waitlist

- [ ] The landing page's waitlist needs nothing set up. New signups appear on the admin page.
- [ ] Set `EMAIL_PROVIDER=resend`, `EMAIL_API_KEY` and `EMAIL_FROM` on the web host, because the waitlist invitation and the welcome email are sent from there. Optionally set `EMAIL_REPLY_TO` to an inbox you read: the welcome email then invites beta testers to reply with feedback. Without these, the invitation is written to `.local/outbox` instead of being sent.

## Writing CVs

- [ ] Keep a worker running with `npm run worker -- --loop`, since the worker writes every CV, within seconds of someone asking. With the worker off, a request waits until it's back.

## Before inviting anyone who isn't you

- [ ] **TODO(Tony): have the privacy policy reviewed against the Nigeria Data Protection Act 2023.** `apps/web/app/privacy/page.tsx` is a draft, not legal advice.
- [ ] Move to Level 3 (API key).
