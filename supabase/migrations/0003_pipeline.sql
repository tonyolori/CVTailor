-- Worker state: score cache, daily summaries, AI task queue, settings.

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
alter table public.profiles
  -- Invented test personas. Set only by the seed script with the service role.
  add column is_synthetic boolean not null default false,
  -- Where the daily email goes when it isn't the sign-in address.
  add column notify_email text,
  -- Token for the one-click unsubscribe link; the link pauses email without signing in.
  add column unsubscribe_token uuid not null default gen_random_uuid() unique,
  add column email_paused boolean not null default false;

grant update (notify_email, email_paused) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Preferences version: part of the score cache key
-- ---------------------------------------------------------------------------
alter table public.preferences add column version int not null default 1;

create or replace function public.bump_preferences_version()
returns trigger language plpgsql as $$
begin
  if new.data is distinct from old.data then
    new.version = old.version + 1;
  end if;
  return new;
end $$;
create trigger preferences_bump_version before update on public.preferences
  for each row execute function public.bump_preferences_version();

create or replace function public.bump_fact_library_version()
returns trigger language plpgsql as $$
begin
  if new.data is distinct from old.data then
    new.version = old.version + 1;
  end if;
  return new;
end $$;
create trigger fact_library_bump_version before update on public.fact_library
  for each row execute function public.bump_fact_library_version();

-- ---------------------------------------------------------------------------
-- Score cache, keyed by (user, job, preferences version)
-- ---------------------------------------------------------------------------
create table public.match_scores (
  user_id             uuid not null references public.profiles (id) on delete cascade,
  job_id              bigint not null references public.jobs (id) on delete cascade,
  preferences_version int not null,
  role_match          numeric(2,1) not null,
  library_fit         numeric(2,1) not null,
  reason              text,
  created_at          timestamptz not null default now(),
  primary key (user_id, job_id, preferences_version)
);
alter table public.match_scores enable row level security;
-- No policies: internal to the worker.

-- ---------------------------------------------------------------------------
-- Matches: enough to resume a crashed run and to explain a decision
-- ---------------------------------------------------------------------------
alter table public.matches
  add column run_date     date not null default (now() at time zone 'utc')::date,
  add column tier         text,                     -- core | a | b | c
  add column gate_failures text[] not null default '{}',
  add column notes        text[] not null default '{}',
  add column verified     boolean,                  -- null = not checked, false = could not reach the live posting
  add column verified_note text,
  -- Where this match is in the per-user pipeline. Only 'picked' matches move past 'none'.
  add column tailor_status text not null default 'none'
    check (tailor_status in ('none','pending','drafted','rendered','failed','skipped')),
  add column tailor_error text;
create index matches_run_idx on public.matches (run_date, tailor_status);

alter table public.resume_versions add column verify_issues jsonb;

-- ---------------------------------------------------------------------------
-- One row per user per day: the summary the dashboard shows and the email sends
-- ---------------------------------------------------------------------------
create table public.daily_summaries (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  run_date   date not null,
  data       jsonb not null,
  send_at    timestamptz,
  status     text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  sent_at    timestamptz,
  provider_message_id text,
  error      text,
  created_at timestamptz not null default now(),
  primary key (user_id, run_date)
);
alter table public.daily_summaries enable row level security;
create policy "own summaries: read" on public.daily_summaries for select to authenticated
  using (user_id = (select auth.uid()));
create index daily_summaries_due_idx on public.daily_summaries (status, send_at);

-- ---------------------------------------------------------------------------
-- One row per day: did the shared pipeline finish?
-- ---------------------------------------------------------------------------
create table public.daily_runs (
  run_date    date primary key,
  status      text not null default 'running' check (status in ('running','ok','failed')),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  alert_sent_at timestamptz,
  detail      jsonb
);
alter table public.daily_runs enable row level security;

-- ---------------------------------------------------------------------------
-- Queue for AI work the web app can't do itself (for example no key on the web host).
-- Claimed with FOR UPDATE SKIP LOCKED so a second worker can't double-process.
-- ---------------------------------------------------------------------------
create table public.ai_tasks (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       text not null check (kind in ('extract_facts','suggest_titles')),
  input      jsonb not null,
  status     text not null default 'pending' check (status in ('pending','running','done','failed','skipped')),
  output     jsonb,
  error      text,
  attempts   int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger ai_tasks_updated_at before update on public.ai_tasks
  for each row execute function public.set_updated_at();
alter table public.ai_tasks enable row level security;
create index ai_tasks_pending_idx on public.ai_tasks (created_at) where status = 'pending';
create policy "own ai tasks: read" on public.ai_tasks for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own ai tasks: insert" on public.ai_tasks for insert to authenticated
  with check (user_id = (select auth.uid()));

create or replace function public.claim_ai_task()
returns public.ai_tasks language plpgsql security definer set search_path = public as $$
declare
  task public.ai_tasks;
begin
  select * into task from public.ai_tasks
    where status = 'pending'
    order by created_at
    for update skip locked
    limit 1;
  if task.id is null then
    return null;
  end if;
  update public.ai_tasks set status = 'running', attempts = attempts + 1 where id = task.id
    returning * into task;
  return task;
end $$;
revoke execute on function public.claim_ai_task() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Settings: global kill switch and the admin list
-- ---------------------------------------------------------------------------
create table public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
-- No policies: service role only.
insert into public.app_settings (key, value) values
  ('kill_switch', 'false'),
  ('admin_emails', '[]');

-- ---------------------------------------------------------------------------
-- Cost records say where they came from: subscription runs report an estimate, not a bill.
-- ---------------------------------------------------------------------------
alter table public.runs
  add column provider text,
  add column calls    int not null default 0;

-- Per-user-per-day spend for the budget check and the admin page.
create or replace view public.daily_spend with (security_invoker = true) as
  select run_date, user_id, sum(cost_usd) as cost_usd, sum(tokens_in) as tokens_in,
         sum(tokens_out) as tokens_out, sum(calls) as calls
    from public.runs
   group by run_date, user_id;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on public.match_scores, public.daily_summaries, public.daily_runs,
              public.ai_tasks, public.app_settings, public.daily_spend
  from anon, authenticated;
grant select on public.daily_summaries to authenticated;
grant select on public.ai_tasks to authenticated;
grant insert (user_id, kind, input) on public.ai_tasks to authenticated;
