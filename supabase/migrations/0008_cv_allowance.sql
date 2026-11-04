-- CVs are written only when someone asks, and each one uses up an allowance.
-- Plan CVs last as long as the plan. Free CVs are a one-off to try it. Extra CVs never expire.
alter table public.profiles
  add column cv_plan_left  int not null default 0 check (cv_plan_left >= 0),
  add column cv_free_left  int not null default 3 check (cv_free_left >= 0),
  add column cv_extra_left int not null default 0 check (cv_extra_left >= 0);
-- No grant: users read these with the rest of their profile, and can never write them.

-- Anyone on a paid plan today keeps what they paid for.
update public.profiles set cv_plan_left = 30 where plan = 'pro' and paid_until > now();

-- Which allowance a queued CV came from, so a failure or a cancel can give it back exactly once.
alter table public.ai_tasks
  add column cv_bucket text check (cv_bucket in ('plan','free','extra','none'));

-- Every change to someone's allowance, for answering "where did my CVs go?".
create table public.cv_ledger (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  bucket     text not null check (bucket in ('plan','free','extra')),
  delta      int not null,
  reason     text not null,
  created_at timestamptz not null default now()
);
create index cv_ledger_user_idx on public.cv_ledger (user_id, created_at desc);
alter table public.cv_ledger enable row level security;
create policy "own cv ledger: read" on public.cv_ledger for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.cv_ledger from anon, authenticated;
grant select on public.cv_ledger to authenticated;

-- Takes one CV, or returns null if there are none left. Plan CVs go first, because they expire.
create or replace function public.reserve_cv(uid uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  p public.profiles;
  bucket text;
begin
  select * into p from public.profiles where id = uid for update;
  if p.id is null then
    return null;
  end if;
  if p.cv_plan_left > 0 and p.plan = 'pro' and p.paid_until > now() then
    bucket := 'plan';
    update public.profiles set cv_plan_left = cv_plan_left - 1 where id = uid;
  elsif p.cv_free_left > 0 then
    bucket := 'free';
    update public.profiles set cv_free_left = cv_free_left - 1 where id = uid;
  elsif p.cv_extra_left > 0 then
    bucket := 'extra';
    update public.profiles set cv_extra_left = cv_extra_left - 1 where id = uid;
  else
    return null;
  end if;
  insert into public.cv_ledger (user_id, bucket, delta, reason) values (uid, bucket, -1, 'cv_requested');
  return bucket;
end $$;

create or replace function public.return_cv(uid uuid, bucket text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if bucket = 'plan' then
    update public.profiles set cv_plan_left = cv_plan_left + 1 where id = uid;
  elsif bucket = 'free' then
    update public.profiles set cv_free_left = cv_free_left + 1 where id = uid;
  elsif bucket = 'extra' then
    update public.profiles set cv_extra_left = cv_extra_left + 1 where id = uid;
  else
    return;
  end if;
  insert into public.cv_ledger (user_id, bucket, delta, reason) values (uid, bucket, 1, 'cv_not_written');
end $$;

-- Gives back a task's CV. Clearing the bucket in the same statement means it can only happen once.
create or replace function public.refund_task_cv(task_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  owner uuid;
  taken text;
begin
  update public.ai_tasks t set cv_bucket = null
    from (select id, user_id, cv_bucket from public.ai_tasks where id = task_id for update) old
    where t.id = old.id and old.cv_bucket in ('plan','free','extra')
    returning old.user_id, old.cv_bucket into owner, taken;
  if owner is not null then
    perform public.return_cv(owner, taken);
  end if;
end $$;

/*
 * One payment, all or nothing: the record, the extended plan and the CVs. A repeat of the same
 * reference changes nothing, so a retried webhook can't grant anything twice.
 *   plan_reset: a monthly renewal. Unused CVs don't roll over.
 *   plan_add:   a one-off pass. Bought while a plan is running, it adds to what's left.
 *   extra:      a top-up. It doesn't change the plan, and never expires.
 */
create or replace function public.record_payment(
  p_user uuid, p_event_id text, p_reference text, p_amount_kobo bigint, p_currency text,
  p_days int, p_cvs int, p_grant text
) returns boolean language plpgsql security definer set search_path = public as $$
declare
  added int;
  plan_running boolean;
begin
  insert into public.payments (user_id, event_id, reference, amount_kobo, currency, status)
    values (p_user, p_event_id, p_reference, p_amount_kobo, p_currency, 'success')
    on conflict do nothing;
  get diagnostics added = row_count;
  if added = 0 then
    return false;
  end if;
  if p_user is null then
    return true;
  end if;

  select plan = 'pro' and paid_until > now() into plan_running from public.profiles where id = p_user for update;

  if p_grant = 'extra' then
    update public.profiles set cv_extra_left = cv_extra_left + p_cvs where id = p_user;
    insert into public.cv_ledger (user_id, bucket, delta, reason) values (p_user, 'extra', p_cvs, 'top_up');
  else
    update public.profiles
       set plan = 'pro',
           paid_until = greatest(coalesce(paid_until, now()), now()) + make_interval(days => p_days),
           cv_plan_left = case
             when p_grant = 'plan_add' and plan_running then cv_plan_left + p_cvs
             when p_grant = 'plan_add' then p_cvs
             when plan_running then greatest(cv_plan_left, p_cvs)
             else p_cvs
           end
     where id = p_user;
    insert into public.cv_ledger (user_id, bucket, delta, reason) values (p_user, 'plan', p_cvs, p_grant);
  end if;
  return true;
end $$;

revoke execute on function public.reserve_cv(uuid) from public, anon, authenticated;
revoke execute on function public.return_cv(uuid, text) from public, anon, authenticated;
revoke execute on function public.refund_task_cv(bigint) from public, anon, authenticated;
revoke execute on function public.record_payment(uuid, text, text, bigint, text, int, int, text) from public, anon, authenticated;
