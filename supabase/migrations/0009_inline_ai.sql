-- CVs and onboarding's AI steps now run on the web host as people ask, so the queue the worker
-- polled is gone. What's left is a record of each CV request. It holds the CV taken from the
-- allowance, so any outcome but a written CV gives it back, exactly once.

-- Anything still queued would never run now. Give back what it took, and say the CV wasn't written.
update public.matches m set tailor_status = 'failed', tailor_error = 'interrupted'
  from public.ai_tasks t
  where t.kind = 'tailor_match' and t.status in ('pending','running') and t.match_id = m.id
    and m.tailor_status in ('pending','drafted');
select public.refund_task_cv(id) from public.ai_tasks where kind = 'tailor_match' and status in ('pending','running');

drop function public.claim_ai_task();
drop function public.refund_task_cv(bigint);
drop table public.ai_tasks;

create table public.cv_requests (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  match_id    bigint not null references public.matches (id) on delete cascade,
  -- Which allowance it came from. Cleared when the CV is given back.
  cv_bucket   text check (cv_bucket in ('plan','free','extra','none')),
  status      text not null default 'running' check (status in ('running','done','failed')),
  -- Shown to the person, so plain words only.
  error       text,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index cv_requests_user_idx on public.cv_requests (user_id, created_at desc);
-- One CV at a time for a job: asking twice shouldn't cost twice.
create unique index cv_requests_one_running_idx on public.cv_requests (match_id) where status = 'running';
alter table public.cv_requests enable row level security;
create policy "own cv requests: read" on public.cv_requests for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.cv_requests from anon, authenticated;
grant select on public.cv_requests to authenticated;

-- Ends a request once. A failure gives back its CV in the same statement, so that can't happen twice.
create or replace function public.finish_cv_request(request_id bigint, ok boolean, err text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  owner uuid;
  taken text;
begin
  update public.cv_requests r
     set status = case when ok then 'done' else 'failed' end,
         error = case when ok then null else err end,
         finished_at = now(),
         cv_bucket = case when ok then old.cv_bucket else null end
    from (select id, user_id, cv_bucket from public.cv_requests where id = request_id and status = 'running' for update) old
   where r.id = old.id
   returning old.user_id, old.cv_bucket into owner, taken;
  if owner is null then
    return false;
  end if;
  if not ok and taken in ('plan','free','extra') then
    perform public.return_cv(owner, taken);
  end if;
  return true;
end $$;

-- A request still running after ten minutes was cut off along with the function writing it, since
-- none may run that long. It fails, which gives its CV back and frees the job. No uid means everyone.
create or replace function public.expire_cv_requests(uid uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select id, match_id from public.cv_requests
     where status = 'running' and created_at < now() - interval '10 minutes' and (uid is null or user_id = uid)
  loop
    if public.finish_cv_request(r.id, false, 'Writing this CV took too long, so we stopped. Try again, and it won''t use up a CV.') then
      update public.matches set tailor_status = 'failed', tailor_error = 'timed_out'
       where id = r.match_id and tailor_status in ('pending','drafted');
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

revoke execute on function public.finish_cv_request(bigint, boolean, text) from public, anon, authenticated;
revoke execute on function public.expire_cv_requests(uuid) from public, anon, authenticated;
