-- Any occupation, work mode and location. Occupation is data, not an enum.

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------
create table public.categories (
  id         text primary key check (id ~ '^[a-z0-9-]+$'),
  label      text not null,
  -- Cheap pre-filter terms, matched against posting titles before any LLM call.
  keywords   text[] not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.categories enable row level security;
create policy "categories: read" on public.categories for select to authenticated using (true);

-- Categories the model proposed that aren't in the table yet, kept for review.
create table public.category_review (
  raw_value  text primary key,
  seen       int not null default 1,
  example_job_id bigint references public.jobs (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.category_review enable row level security;
-- No policies: internal to the worker and the admin page.

insert into public.categories (id, label, keywords) values
  ('other', 'Other', '{}'),
  ('software-engineering', 'Software engineering',
   '{software,developer,engineer,backend,frontend,"full stack",fullstack,devops,sre,programmer,"forward deployed",platform}'),
  ('data-ai', 'Data and AI',
   '{data,analytics,"machine learning",ml,ai,llm,analyst,scientist}'),
  ('accounting-finance', 'Accounting and finance',
   '{accountant,accounting,finance,financial,auditor,audit,bookkeeper,controller,treasury,tax,payroll}'),
  ('nursing-healthcare', 'Nursing and healthcare',
   '{nurse,nursing,midwife,clinical,healthcare,physician,doctor,pharmacist,carer,therapist,dentist}'),
  ('teaching-education', 'Teaching and education',
   '{teacher,tutor,lecturer,instructor,educator,teaching,professor,headteacher}'),
  ('marketing-communications', 'Marketing and communications',
   '{marketing,seo,content,copywriter,communications,brand,"social media",pr}'),
  ('sales-customer', 'Sales and customer roles',
   '{sales,account,customer,support,success,"business development"}'),
  ('design-creative', 'Design and creative',
   '{designer,design,ux,ui,illustrator,creative,artist,animator}'),
  ('operations-admin', 'Operations and administration',
   '{operations,administrator,assistant,coordinator,"office manager",logistics,procurement,supply}'),
  ('hr-people', 'HR and people',
   '{hr,recruiter,recruitment,people,talent,"human resources"}'),
  ('legal-compliance', 'Legal and compliance',
   '{lawyer,solicitor,paralegal,legal,compliance,counsel,attorney}'),
  ('engineering-trades', 'Engineering and trades',
   '{mechanical,civil,electrical,electrician,technician,plumber,welder,site}');

-- ---------------------------------------------------------------------------
-- Companies and jobs: enough columns to pre-filter without reading JSON
-- ---------------------------------------------------------------------------
alter table public.companies
  add column tags      text[] not null default '{}',
  add column countries text[] not null default '{}';

alter table public.jobs
  add column category     text,
  add column country      text,
  add column work_mode    text,
  add column location_text text,
  -- Structured location and date fields from the ATS, fed to enrichment as given.
  add column ats_fields   jsonb,
  add column ats_posted_at timestamptz,
  add column filter_reason text;
alter table public.jobs drop constraint jobs_status_check;
alter table public.jobs add constraint jobs_status_check
  check (status in ('new','filtered','enriched','verified','closed','failed'));
create index jobs_category_idx on public.jobs (category);
create index jobs_country_idx on public.jobs (country);

-- Default privileges would give anon and authenticated everything on new tables.
revoke all on public.categories, public.category_review from anon, authenticated;
grant select on public.categories to authenticated;
