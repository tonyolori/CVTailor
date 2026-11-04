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
- [ ] In `.env`: `LLM_PROVIDER=claude-subscription` and `OWNER_EMAIL=<your account email in JobTailor>`.
- [ ] Check it: `npm run llm:check`
- [ ] Do **not** set `ANTHROPIC_API_KEY` in this mode. It's ignored for AI calls here, but it's easy to mistake for what's being billed.
- [ ] If runs stop early with a usage-limit note, lower `ENRICH_MAX_PER_RUN` or `daily_cap`, or run at a quieter time. The next run picks up where it stopped.

**Limits of this mode.** It is for your own testing. Anthropic's terms do not allow routing requests through a personal plan on behalf of other people, so the worker runs AI stages only for `OWNER_EMAIL` and synthetic personas. Real test users need Level 3.

## Level 3: API key (any invited user)

- [ ] Create a key in the [Claude Console](https://platform.claude.com/).
- [ ] **Set a monthly spend limit in the Console** before using it. This is the only hard ceiling; the app's budgets are a second line of defence.
- [ ] In `.env`: `LLM_PROVIDER=anthropic-api`, `ANTHROPIC_API_KEY=...`
- [ ] `npm run llm:check`, then `npm run eval:enrich -- --limit 10` to see real costs.

Max, Ultra and Team plans include monthly API credits for a linked Console org ([details](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)). Check whether yours does before paying separately.

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

### Web host (Vercel or Cloudflare Pages)
- [ ] Create a project with `apps/web` as its root and add the env vars listed in `.env.example` under "Web app".
- [ ] Set `NEXT_PUBLIC_SITE_URL` to the deployed URL. Sign-in redirects depend on it.
- [ ] Set `CRON_SECRET`, `OWNER_EMAIL`, `EMAIL_API_KEY` and `EMAIL_FROM`. The daily check in `apps/web/vercel.json` uses them to alert you when no run has finished. On Cloudflare Pages, call `/api/cron/run-check` from a Cron Trigger instead.
- [ ] Set `SUPABASE_SERVICE_ROLE_KEY` as a server-only variable. Account deletion, unsubscribe, webhooks and admin use it.
- [ ] Leave `ANTHROPIC_API_KEY` unset on the web host unless you're at Level 3. Without it, onboarding's AI steps queue for the worker.

### Worker on your PC
- [ ] Follow `docs/SCHEDULING.md` for Windows Task Scheduler or systemd.

## Level 5: paid plans

Matches are free for everyone. Once billing is on, each CV uses one from the person's allowance: 3 free to try it, 30 with a plan, and 10 more in each top-up. A CV that can't be written is given back. Until billing is on, nothing is counted. The numbers are constants in `packages/core/src/resume.ts`, and the free one is also the default on `profiles.cv_free_left`.

- [ ] Create a Paystack account and complete its business verification.
- [ ] Set the webhook URL to `<site>/api/webhooks/paystack`.
- [ ] Create a monthly plan in Paystack. Put its code in `PAYSTACK_PLAN_CODE_MONTHLY`, and set `PAYSTACK_SECRET_KEY`, `PAYSTACK_PRICE_MONTHLY_KOBO`, `PAYSTACK_PRICE_ONCE_KOBO` and `PAYSTACK_PRICE_TOPUP_KOBO` on the web host.
- [ ] **TODO(verify): Paystack's docs block automated reading, so I couldn't read them directly.** The signature scheme is confirmed. Event names and payload fields come from secondary sources, so send test events from the Paystack dashboard and confirm `apps/web/lib/paystack.ts` handles them, using test keys, before taking real money.
- [ ] Make one real test-mode checkout for each plan and a top-up, and check that Settings shows the new CVs. A redirect back from Paystack proves nothing: only the webhook grants a plan.
- [ ] Decide pricing using cost per user per day on the admin page.
- [ ] Set `CV_REQUESTS_PER_DAY` on the web host and the worker. It's a safeguard against abuse, on top of the allowance, and it defaults to 7.
- [ ] Set `BILLING_ENFORCED=true` on **both the web host and the worker** when you're ready. This also turns off Remotive, whose free API excludes commercial use.

## Waitlist

- [ ] The landing page's waitlist needs nothing set up. New signups appear on the admin page.
- [ ] Set `EMAIL_PROVIDER=resend`, `EMAIL_API_KEY` and `EMAIL_FROM` on the web host, because inviting someone from the waitlist emails them from there. Without these, the invitation is written to `.local/outbox` instead of being sent.

## Writing CVs

- [ ] Keep a worker running with `npm run worker -- --loop`, since the worker writes every CV, within seconds of someone asking. With the worker off, a request waits until it's back.

## Before inviting anyone who isn't you

- [ ] **TODO(Tony): have the privacy policy reviewed against the Nigeria Data Protection Act 2023.** `apps/web/app/privacy/page.tsx` is a draft, not legal advice.
- [ ] Move to Level 3 (API key).
