-- Matching quality: a second, closer score for the best candidates, and a record of missed days.

-- The strong model's score, read against the full posting. Null until a candidate is refined.
-- When present it replaces the first-pass score.
alter table public.match_scores
  add column refined_role_match  numeric(2,1),
  add column refined_library_fit numeric(2,1),
  add column refined_reason      text;

-- A day with no run at all is recorded as 'missed' when it's noticed, so it's alerted once.
alter table public.daily_runs drop constraint daily_runs_status_check;
alter table public.daily_runs add constraint daily_runs_status_check
  check (status in ('running','ok','failed','missed'));

-- Both tables stay internal: privileges were revoked from anon and authenticated in 0003.
