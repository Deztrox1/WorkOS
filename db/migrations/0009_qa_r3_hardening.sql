-- 0009_qa_r3_hardening.sql  (WorkOS, 2026-10-29)
-- QA round 3 (logs/qa-r3-security.md R3S06, R3S07, R3S08, R3S10). Append-only: never edit after it is applied.
-- The 0007/0008 guard functions are protected by db/apply.py, so new rules come as new functions and triggers.
--   1. A Claude request's created_at and updated_at are always the server's clock on insert, so a row dated in the
--      future cannot dodge the poller's 24 h expiry (R3S06).
--   2. Session links must be a Claude Code page (claude.ai/code/), not any claude.ai page (R3S07).
--   3. The reminder sender's own keys (push_last_run, push_digest_on, push_stale_on) are server-only, so a stolen
--      session cannot fake a live sender and keep the watchdog green (R3S10).
--   4. Functions made later are not executable by PUBLIC by default; 0008's per-schema revoke could not do that (R3S08).
-- db/apply.py now also checks the catalog after every migration from 0009 on (R3S01).

-- ------------------------------------------------------------- 1. server clock on insert
create function public.os_claude_requests_born() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.created_at := now();
  new.updated_at := now();
  return new;
end $$;
create trigger os_claude_requests_born before insert on public.os_claude_requests
  for each row execute function public.os_claude_requests_born();

-- ------------------------------------------------------------- 2. Claude Code links only
alter table public.os_claude_requests
  drop constraint if exists os_claude_requests_session_host,
  add constraint os_claude_requests_session_host check (session_url is null or session_url ~ '^https://claude\.ai/code/') not valid;

-- ------------------------------------------------------------- 3. the sender's keys
create function public.os_guard_push_keys() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and (
       (tg_op in ('UPDATE', 'DELETE') and old.key in ('push_last_run', 'push_digest_on', 'push_stale_on'))
    or (tg_op in ('INSERT', 'UPDATE') and new.key in ('push_last_run', 'push_digest_on', 'push_stale_on'))) then
    raise exception 'This setting is written by the server only.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;
create trigger os_settings_guard_push_keys before insert or update or delete on public.os_settings
  for each row execute function public.os_guard_push_keys();

-- ------------------------------------------------------------- 4. function privileges
alter default privileges revoke execute on functions from public;
revoke execute on function public.os_claude_requests_born() from public, anon, authenticated;
revoke execute on function public.os_guard_push_keys() from public, anon, authenticated;
-- 0001 granted every public table to authenticated, and Supabase default privileges did the same for the view 0007
-- made. Both views are read-only (the catalog check in apply.py now holds them to SELECT).
revoke insert, update, delete, truncate, references, trigger on public.os_campaigns_latest, public.os_campaign_daily from authenticated;

-- ------------------------------------------------------------------- validate
do $$
begin
  execute 'alter table public.os_claude_requests validate constraint os_claude_requests_session_host';
exception when check_violation then
  raise notice 'os_claude_requests_session_host left NOT VALID: existing rows break it (new writes are still checked)';
end $$;
