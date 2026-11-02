-- Local development only. Applied by `supabase db reset`; never pushed to a real project.
-- Personas themselves are created by `npm run seed:personas` through the Admin API.
insert into public.allowed_emails (email, note) values
  ('persona.software@jobtailor.test', 'synthetic persona'),
  ('persona.accountant@jobtailor.test', 'synthetic persona'),
  ('persona.nurse@jobtailor.test', 'synthetic persona'),
  ('rls.a@jobtailor.test', 'RLS test user'),
  ('rls.b@jobtailor.test', 'RLS test user')
on conflict (email) do nothing;
