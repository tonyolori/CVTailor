-- A role that passed the gates but couldn't be scored, because AI isn't available for this
-- account under the current provider, or a budget ran out. Rescored on a later run.
alter table public.matches drop constraint matches_decision_check;
alter table public.matches add constraint matches_decision_check
  check (decision in ('picked','worth-a-look','skipped','below-threshold','unscored'));
