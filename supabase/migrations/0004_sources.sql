-- Columns the shared ingestion stage needs.
alter table public.jobs
  add column apply_url   text,
  -- Same posting seen on two sources: company and title, normalised.
  add column dedupe_key  text,
  add column from_ats    boolean not null default false,
  add column last_seen   timestamptz not null default now();
create index jobs_dedupe_idx on public.jobs (dedupe_key);

alter table public.companies
  add column name text,
  add column last_failure_at timestamptz;

-- Key-value record of when periodic jobs last ran.
insert into public.app_settings (key, value) values ('last_discovery_at', 'null')
on conflict (key) do nothing;
