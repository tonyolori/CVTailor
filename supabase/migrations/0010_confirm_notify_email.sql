-- A different address for the daily email has to be confirmed from that inbox before anything is
-- sent to it, so nobody can point the emails at someone else. Until then email keeps going to the
-- address already in use.
alter table public.profiles
  add column notify_email_pending    text,
  -- sha256 of the token in the confirmation link. The row is readable by its owner, so the token
  -- itself is never stored: seeing the row mustn't be enough to confirm.
  add column notify_email_token_hash text,
  add column notify_email_sent_at    timestamptz;

-- Only the server sets these, after the link is used.
revoke update (notify_email) on public.profiles from authenticated;
