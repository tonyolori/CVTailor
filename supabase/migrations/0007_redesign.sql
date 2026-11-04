-- Redesign: CV styles, CVs written on request, pasted jobs and the waitlist.

-- ---------------------------------------------------------------------------
-- CV styles: one per user, with an optional override per CV.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column cv_style text not null default 'fitted'
    check (cv_style in ('fitted','classic','plain','compact'));
grant update (cv_style) on public.profiles to authenticated;

alter table public.matches
  add column cv_style text
    check (cv_style in ('fitted','classic','plain','compact')),
  -- The posting a user pasted for a job we hold no text for. Their own, so never on the shared job.
  add column posting_text text;
grant update (cv_style) on public.matches to authenticated;

-- ---------------------------------------------------------------------------
-- Pasted jobs: a job with an owner is private to that owner.
-- ---------------------------------------------------------------------------
alter table public.matches drop constraint matches_decision_check;
alter table public.matches add constraint matches_decision_check
  check (decision in ('picked','worth-a-look','skipped','below-threshold','unscored','pasted'));

alter table public.jobs
  add column owner_id uuid references public.profiles (id) on delete cascade;
create index jobs_owner_idx on public.jobs (owner_id) where owner_id is not null;

drop policy "jobs: read" on public.jobs;
create policy "jobs: read" on public.jobs for select to authenticated
  using (owner_id is null or owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- CVs on request run on the worker. Paid-only, so only the server may queue them:
-- the insert policy keeps a signed-in user to the onboarding tasks they always had.
-- ---------------------------------------------------------------------------
alter table public.ai_tasks drop constraint ai_tasks_kind_check;
alter table public.ai_tasks add constraint ai_tasks_kind_check
  check (kind in ('extract_facts','suggest_titles','tailor_match'));
alter table public.ai_tasks
  add column match_id bigint references public.matches (id) on delete cascade;
create index ai_tasks_user_kind_idx on public.ai_tasks (user_id, kind, created_at desc);

drop policy "own ai tasks: insert" on public.ai_tasks;
create policy "own ai tasks: insert" on public.ai_tasks for insert to authenticated
  with check (user_id = (select auth.uid()) and kind in ('extract_facts','suggest_titles'));

-- ---------------------------------------------------------------------------
-- Waitlist: people who've registered interest. Service role only.
-- ---------------------------------------------------------------------------
create table public.waitlist (
  email       text primary key check (email = lower(email)),
  name        text,
  looking_for text,
  consented_at timestamptz not null,
  created_at  timestamptz not null default now(),
  invited_at  timestamptz
);
alter table public.waitlist enable row level security;
-- No policies: service role only.
revoke all on public.waitlist from anon, authenticated;
