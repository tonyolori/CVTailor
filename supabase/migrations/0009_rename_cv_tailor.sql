-- The service is now called CV Tailor. People see this message when an email isn't on the allow-list.
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
