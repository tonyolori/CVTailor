-- CV Tailor initial schema.
-- The worker uses the service-role key, which bypasses RLS. Browsers only ever
-- use the anon key + the user's JWT, so everything below is written for that case.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Invite-only signup
-- ---------------------------------------------------------------------------
create table public.allowed_emails (
  email      text primary key check (email = lower(email)),
  note       text,
  created_at timestamptz not null default now()
);
alter table public.allowed_emails enable row level security;
-- No policies: only the service role (you) can read or write the allow-list.

-- Before-user-created auth hook: rejects signups whose email is not on the list.
-- Enable it under Authentication > Hooks (or in config.toml) and point it at this function.
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb language plpgsql stable as $$
begin
  if exists (
    select 1 from public.allowed_emails
    where email = lower(event->'user'->>'email')
  ) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'error', jsonb_build_object(
      'message', 'CV Tailor is invite-only right now.',
      'http_code', 403
    )
  );
end $$;

grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_before_user_created(jsonb) from authenticated, anon, public;
grant select on public.allowed_emails to supabase_auth_admin;
create policy "auth admin reads allow-list" on public.allowed_emails
  for select to supabase_auth_admin using (true);

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  display_name text,
  tz           text not null default 'UTC',          -- IANA zone, e.g. Africa/Lagos
  send_time    time not null default '08:00',        -- local time the email should land
  daily_cap    int  not null default 5 check (daily_cap between 1 and 10),
  active       boolean not null default true,        -- user pause switch
  plan         text not null default 'free' check (plan in ('free', 'pro')),
  paid_until   timestamptz,                          -- entitlement, set by the webhook only
  consented_at timestamptz,                          -- privacy-policy consent
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, lower(new.email));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Entitled = has a paid plan that has not expired. The worker filters on this.
create or replace function public.is_entitled(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select plan = 'pro' and paid_until is not null and paid_until > now()
       from public.profiles where id = uid),
    false);
$$;

-- ---------------------------------------------------------------------------
-- Per-user data
-- ---------------------------------------------------------------------------
create table public.preferences (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  data       jsonb not null,                         -- validated with PreferencesSchema
  updated_at timestamptz not null default now()
);
create trigger preferences_updated_at before update on public.preferences
  for each row execute function public.set_updated_at();

create table public.fact_library (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  data       jsonb not null,                         -- validated with FactLibrarySchema
  version    int not null default 1,
  updated_at timestamptz not null default now()
);
create trigger fact_library_updated_at before update on public.fact_library
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Shared job data (written by the worker, read-only for users)
-- ---------------------------------------------------------------------------
create table public.companies (
  id         bigint generated always as identity primary key,
  ats        text not null check (ats in ('gh','lever','ashby','workable','breezy','recruitee','page','lead')),
  slug       text not null,
  notes      text,
  fail_count int  not null default 0,               -- two failures in a row => move back to lead
  last_ok    timestamptz,
  created_at timestamptz not null default now(),
  unique (ats, slug)
);
alter table public.companies enable row level security;
-- No policies: internal to the worker.

create table public.jobs (
  id            bigint generated always as identity primary key,
  url           text not null unique,
  company       text not null,
  title         text not null,
  source        text not null,
  posted_at     timestamptz,
  first_seen    timestamptz not null default now(),
  raw_text      text,
  enriched      jsonb,                               -- validated with EnrichedJobSchema
  status        text not null default 'new' check (status in ('new','enriched','verified','closed','failed')),
  last_verified timestamptz
);
create index jobs_status_seen_idx on public.jobs (status, first_seen desc);

-- ---------------------------------------------------------------------------
-- Matches and documents
-- ---------------------------------------------------------------------------
create table public.matches (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  job_id         bigint not null references public.jobs (id) on delete cascade,
  score          numeric(3,1),
  decision       text not null check (decision in ('picked','worth-a-look','skipped','below-threshold')),
  reason         text,
  tracker_status text not null default 'to_apply'
                 check (tracker_status in ('to_apply','applied','interview','offer','rejected','dismissed')),
  created_at     timestamptz not null default now(),
  unique (user_id, job_id)
);
create index matches_user_created_idx on public.matches (user_id, created_at desc);

create table public.resume_versions (
  id         bigint generated always as identity primary key,
  match_id   bigint not null references public.matches (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       text not null default 'resume' check (kind in ('resume','cover_letter')),
  json       jsonb not null,                         -- ResumeSchema for resumes
  source     text not null check (source in ('ai','user')),
  created_at timestamptz not null default now()
);
create index resume_versions_match_idx on public.resume_versions (match_id, created_at desc);

create table public.documents (
  id           bigint generated always as identity primary key,
  match_id     bigint not null references public.matches (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  kind         text not null check (kind in ('resume_pdf','cover_letter_pdf')),
  storage_path text not null,                        -- path inside the private "documents" bucket
  version_id   bigint references public.resume_versions (id) on delete set null,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Billing (written by the payment webhook with the service role only)
-- ---------------------------------------------------------------------------
create table public.subscriptions (
  id                 bigint generated always as identity primary key,
  user_id            uuid not null references public.profiles (id) on delete cascade,
  provider           text not null default 'paystack',
  provider_ref       text,
  plan               text not null,
  status             text not null,
  current_period_end timestamptz,
  created_at         timestamptz not null default now()
);

create table public.payments (
  id          bigint generated always as identity primary key,
  user_id     uuid references public.profiles (id) on delete set null,
  provider    text not null default 'paystack',
  event_id    text not null,
  reference   text not null,
  amount_kobo bigint not null,
  currency    text not null default 'NGN',
  status      text not null,
  raw         jsonb,
  created_at  timestamptz not null default now(),
  unique (provider, event_id),                       -- webhook idempotency
  unique (provider, reference)
);

-- ---------------------------------------------------------------------------
-- Observability and cost control
-- ---------------------------------------------------------------------------
create table public.runs (
  id          bigint generated always as identity primary key,
  run_date    date not null default (now() at time zone 'utc')::date,
  user_id     uuid references public.profiles (id) on delete cascade,  -- null = shared stage
  stage       text not null,                         -- collect | enrich | match | tailor | render | email
  status      text not null default 'running' check (status in ('running','ok','failed','skipped')),
  tokens_in   bigint not null default 0,
  tokens_out  bigint not null default 0,
  cost_usd    numeric(10,4) not null default 0,
  error       text,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index runs_date_idx on public.runs (run_date, stage);
create index runs_user_date_idx on public.runs (user_id, run_date);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.preferences     enable row level security;
alter table public.fact_library    enable row level security;
alter table public.jobs            enable row level security;
alter table public.matches         enable row level security;
alter table public.resume_versions enable row level security;
alter table public.documents       enable row level security;
alter table public.subscriptions   enable row level security;
alter table public.payments        enable row level security;
alter table public.runs            enable row level security;

create policy "own profile: read"   on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy "own profile: update" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "own preferences: read"   on public.preferences for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own preferences: insert" on public.preferences for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "own preferences: update" on public.preferences for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own facts: read"   on public.fact_library for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own facts: insert" on public.fact_library for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "own facts: update" on public.fact_library for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Job postings are public data collected by the worker. Users may read, never write.
create policy "jobs: read" on public.jobs for select to authenticated using (true);

create policy "own matches: read"   on public.matches for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own matches: update" on public.matches for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own versions: read"   on public.resume_versions for select to authenticated
  using (user_id = (select auth.uid()));
-- Users can only add their own edits, never forge an 'ai' version.
create policy "own versions: insert" on public.resume_versions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and source = 'user'
    and exists (select 1 from public.matches m
                where m.id = match_id and m.user_id = (select auth.uid()))
  );

create policy "own documents: read" on public.documents for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own subscriptions: read" on public.subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own payments: read" on public.payments for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own runs: read" on public.runs for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Column-level grants: RLS decides which rows, grants decide which columns.
-- Without these a user could update their own `plan` or `paid_until`.
-- ---------------------------------------------------------------------------
revoke all on public.profiles, public.preferences, public.fact_library, public.jobs,
              public.matches, public.resume_versions, public.documents,
              public.subscriptions, public.payments, public.runs,
              public.companies, public.allowed_emails
  from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name, tz, send_time, daily_cap, active, consented_at)
  on public.profiles to authenticated;

grant select, insert, update on public.preferences  to authenticated;
grant select, insert, update on public.fact_library to authenticated;
grant select on public.jobs to authenticated;

grant select on public.matches to authenticated;
grant update (tracker_status) on public.matches to authenticated;

grant select, insert on public.resume_versions to authenticated;
grant select on public.documents, public.subscriptions, public.payments, public.runs
  to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: private bucket for PDFs, one folder per user ("<user_id>/...")
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

create policy "own documents: download" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
