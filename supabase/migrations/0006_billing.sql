-- Paystack webhooks. Every event is recorded first, so a retried delivery does nothing twice.
create table public.webhook_events (
  provider    text not null default 'paystack',
  event_key   text not null,
  event_type  text not null,
  received_at timestamptz not null default now(),
  primary key (provider, event_key)
);
alter table public.webhook_events enable row level security;
-- No policies: service role only.
revoke all on public.webhook_events from anon, authenticated;

alter table public.subscriptions
  add column email_token text,
  add column updated_at timestamptz not null default now();
-- Not a partial index: upserts by (provider, provider_ref) need a full one. NULL refs stay distinct.
alter table public.subscriptions add constraint subscriptions_provider_ref_key unique (provider, provider_ref);

-- Extends entitlement from whichever is later: now, or the current end date.
create or replace function public.extend_paid_until(uid uuid, days int)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  result timestamptz;
begin
  update public.profiles
     set plan = 'pro',
         paid_until = greatest(coalesce(paid_until, now()), now()) + make_interval(days => days)
   where id = uid
   returning paid_until into result;
  return result;
end $$;
revoke execute on function public.extend_paid_until(uuid, int) from public, anon, authenticated;
