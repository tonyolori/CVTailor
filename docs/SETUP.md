# Setup checklist

Things only Tony can do. Items are ordered so you can stop at any point and still have a working system at that level.

## Level 1: local development (no accounts)

- [ ] Docker Desktop running.
- [ ] `npm install`
- [ ] `npx supabase start` (first run downloads images). Copy the printed keys into `.env` using `.env.example`.
- [ ] `npm run db:reset` applies migrations and `supabase/seed.sql`.
- [ ] `npm run seed:personas` creates the two synthetic test users.
- [ ] `npm test` and `npm run test:rls`.

## Level 2: your Claude account, no API key (just you and the synthetic personas)

- [ ] Be on a paid Claude plan. Pro, Max or Ultra all work; heavier plans give more room, because these runs draw from your normal subscription limits.
- [ ] Sign in: `npm run claude:login` runs the Claude Code binary's login. It completes in Anthropic's own browser flow.
- [ ] In `.env`: `LLM_PROVIDER=claude-subscription` and `OWNER_EMAIL=<your account email in JobTailor>`.
- [ ] Check it: `npm run llm:check`
- [ ] Do **not** set `ANTHROPIC_API_KEY` in this mode. It takes precedence over your login, and you would be billed through the API.

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
- [ ] Set `NEXT_PUBLIC_SITE_URL` to the deployed URL.

### Worker on your PC
- [ ] Follow `docs/SCHEDULING.md` for Windows Task Scheduler or systemd.

## Level 5: paid plans (later)

- [ ] Create a Paystack account and complete its business verification.
- [ ] Set the webhook URL to `<site>/api/webhooks/paystack` and put the keys in the web host's env.
- [ ] Decide pricing using cost per user per day on the admin page.

## Before inviting anyone who isn't you

- [ ] **TODO(Tony): have the privacy policy reviewed against the Nigeria Data Protection Act 2023.** `apps/web/app/privacy/page.tsx` is a draft, not legal advice.
- [ ] Move to Level 3 (API key).
