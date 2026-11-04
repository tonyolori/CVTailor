-- Local development only. Applied by `supabase db reset`; never pushed to a real project.
-- Personas themselves are created by `npm run seed:personas` through the Admin API.
insert into public.allowed_emails (email, note) values
  ('persona.software@cvtailor.test', 'synthetic persona'),
  ('persona.accountant@cvtailor.test', 'synthetic persona'),
  ('persona.nurse@cvtailor.test', 'synthetic persona'),
  ('rls.a@cvtailor.test', 'RLS test user'),
  ('rls.b@cvtailor.test', 'RLS test user')
on conflict (email) do nothing;
