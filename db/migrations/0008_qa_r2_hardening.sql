-- 0008_qa_r2_hardening.sql  (WorkOS, 2026-10-29)
-- QA round 2 (logs/qa-r2-security.md R2S*, logs/qa-r2-database.md R2D*). Data contract: logs/qa-r2-plan.md.
-- Append-only: never edit after it is applied.
--   1. os_claude_requests: only the owner's app session can insert (R2S01 a); a request can never be rewritten or
--      turned back into a queued one (R2S01 b); `handoff` records a brief copied into Claude Code by hand (R2P07);
--      session links must be claude.ai (R2S09).
--   2. os_claude_fires: the poller's own fire log, which the app can read but not write (R2S02).
--   3. os_settings: the app cannot write the poller's keys claude_routine and claude_fire_budget (R2S02).
--   4. os_reminders.snooze_of: snooze copies are tagged so they can be deleted once they fire (R2P10).
--   5. os_push_subscriptions.endpoint: known push hosts only (R2S10).
--   6. View os_campaign_baseline24: the real 24 h baseline (R2D02).
--   7. Function EXECUTE: off for authenticated by default and on every trigger function (R2S06).
-- Not here: the narrow DB roles from infra/README.md (see logs/qa-r2-plan.md, "Not built").

-- ------------------------------------------------------------- 1. os_claude_requests
alter table public.os_claude_requests add column if not exists handoff text not null default 'routine';
alter table public.os_claude_requests
  add constraint os_claude_requests_handoff_check check (handoff in ('routine','copy')) not valid,
  add constraint os_claude_requests_session_host check (session_url is null or session_url ~ '^https://claude\.ai/') not valid;

-- Runs before os_claude_requests_stamp (triggers fire in name order). The stamp trigger still sets created_by and
-- checks it is the owner; this one checks WHO is connected and WHAT may change.
--
-- Insert: a PostgREST request runs as session_user `authenticator` with role `authenticated`. A connection made with
-- the DB URL is session_user `postgres` (not a superuser on Supabase, so it cannot change its session user), and
-- can forge request.jwt.claims but not that. So a forged insert is refused here.
--
-- Update: the brief, title, area and handoff are fixed once written; task_id may only become null (the foreign key
-- does that on task delete). Status moves:
--   queued -> firing (poller), cancelled, failed      firing -> queued, sent, failed (poller only)
--   sent   -> done, failed, cancelled                 done, failed, cancelled: final, only seen_at may change
-- "Poller" means a session with no auth.uid(). Nothing ever moves a sent or finished row back to queued.
create function public.os_claude_requests_lock() returns trigger
language plpgsql set search_path = '' as $$
declare
  app boolean := auth.uid() is not null;
begin
  if tg_op = 'INSERT' then
    if session_user::text <> 'authenticator' or current_user::text <> 'authenticated' or not app then
      raise exception 'Only the owner, signed in to the app, can ask Claude.' using errcode = '42501';
    end if;
    new.result := null; new.error := null; new.finished_at := null; new.seen_at := null; new.session_url := null;
    if new.status = 'queued' and new.handoff = 'routine' then
      new.sent_at := null;
    elsif new.status = 'sent' and new.handoff = 'copy' then
      new.sent_at := now();
    else
      raise exception 'A new Claude request is queued for the routine or handed off by copy.' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.brief is distinct from old.brief or new.title is distinct from old.title or new.area is distinct from old.area
     or new.handoff is distinct from old.handoff or new.created_at is distinct from old.created_at
     or (new.task_id is distinct from old.task_id and new.task_id is not null) then
    raise exception 'A Claude request cannot be rewritten. Ask again instead.' using errcode = '42501';
  end if;
  if app and new.attempts is distinct from old.attempts then
    raise exception 'Only the sender counts attempts.' using errcode = '42501';
  end if;
  if old.status in ('done','failed','cancelled') then
    if (new.status, new.result, new.error, new.session_url, new.sent_at, new.finished_at, new.attempts)
       is distinct from (old.status, old.result, old.error, old.session_url, old.sent_at, old.finished_at, old.attempts) then
      raise exception 'This Claude request is finished. Ask again instead.' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'queued' and new.status in ('cancelled','failed'))
    or (old.status = 'queued' and new.status = 'firing' and not app)
    or (old.status = 'firing' and new.status in ('queued','sent','failed') and not app)
    or (old.status = 'sent'   and new.status in ('done','failed','cancelled'))) then
    raise exception 'A Claude request cannot move from % to %.', old.status, new.status using errcode = '42501';
  end if;
  return new;
end $$;
create trigger os_claude_requests_lock before insert or update on public.os_claude_requests
  for each row execute function public.os_claude_requests_lock();

-- ---------------------------------------------------------------- 2. os_claude_fires
-- One row per POST to the routine. The poller (DB URL, bypasses RLS) writes it and counts today's rows against
-- CLAUDE_FIRE_BUDGET from the VPS env file. The owner may read it; nobody signed in may change it.
create table if not exists public.os_claude_fires (
  id         bigint generated always as identity primary key,
  request_id uuid,
  fired_at   timestamptz not null default now()
);
create index if not exists os_claude_fires_at_idx on public.os_claude_fires (fired_at);
alter table public.os_claude_fires enable row level security;
revoke all on public.os_claude_fires from anon, authenticated;
create policy os_claude_fires_owner_read on public.os_claude_fires
  for select to authenticated using ((select public.os_is_owner()));
grant select on public.os_claude_fires to authenticated;

-- ---------------------------------------------------------------- 3. server keys
-- claude_routine is the poller's status line; claude_fire_budget is retired (the budget is in the VPS env now).
-- A signed-in session can no longer write either, so a hijacked session cannot fake "linked" or lift the cap.
create function public.os_guard_server_keys() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and (
       (tg_op in ('UPDATE', 'DELETE') and old.key in ('claude_routine', 'claude_fire_budget'))
    or (tg_op in ('INSERT', 'UPDATE') and new.key in ('claude_routine', 'claude_fire_budget'))) then
    raise exception 'This setting is written by the server only.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;
create trigger os_settings_guard_server_keys before insert or update or delete on public.os_settings
  for each row execute function public.os_guard_server_keys();

-- ------------------------------------------------------------- 4. reminder snoozes
alter table public.os_reminders add column if not exists snooze_of uuid references public.os_reminders(id) on delete cascade;
create index if not exists os_reminders_snooze_idx on public.os_reminders (snooze_of) where snooze_of is not null;

-- --------------------------------------------------------------- 5. push endpoints
alter table public.os_push_subscriptions
  add constraint os_push_endpoint_host check (endpoint ~ '^https://(fcm\.googleapis\.com|[a-z0-9.-]+\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/') not valid;

-- ------------------------------------------------------------- 6. 24 h baseline view
-- Per campaign: the newest snapshot taken between 48 h and 24 h ago (retention keeps hourly rows for 14 days).
create or replace view public.os_campaign_baseline24 with (security_invoker = true) as
select distinct on (s.account, s.campaign_id)
       s.id,
       s.taken_at,
       (s.taken_at at time zone 'Asia/Kolkata')::date as ist_day,
       s.channel,
       s.account,
       s.campaign_id,
       s.sent_total,
       s.replies_total,
       s.positives_total,
       s.bounces_total
  from public.os_campaign_snapshots s
 where s.taken_at <= now() - interval '24 hours'
   and s.taken_at >  now() - interval '48 hours'
 order by s.account, s.campaign_id, s.taken_at desc;
revoke all on public.os_campaign_baseline24 from anon, authenticated;
grant select on public.os_campaign_baseline24 to authenticated;

-- ---------------------------------------------------------- 7. function privileges
-- Trigger functions need no EXECUTE at fire time. Only os_is_owner() (called by every policy) keeps its grant.
alter default privileges in schema public revoke execute on functions from public, authenticated;
revoke execute on function public.os_claude_requests_stamp() from authenticated;
revoke execute on function public.os_claude_requests_lock() from public, anon, authenticated;
revoke execute on function public.os_guard_owner_uid() from authenticated;
revoke execute on function public.os_guard_server_keys() from public, anon, authenticated;
revoke execute on function public.os_tasks_forget_deleted() from authenticated;
revoke execute on function public.os_touch_updated_at() from public, anon, authenticated;

-- ------------------------------------------------------------------- validate
do $$
declare c record;
begin
  for c in select * from (values
      ('os_claude_requests', 'os_claude_requests_handoff_check'),
      ('os_claude_requests', 'os_claude_requests_session_host'),
      ('os_push_subscriptions', 'os_push_endpoint_host')
    ) v(t, n)
  loop
    begin
      execute format('alter table public.%I validate constraint %I', c.t, c.n);
    exception when check_violation then
      raise notice '% on % left NOT VALID: existing rows break it (new writes are still checked)', c.n, c.t;
    end;
  end loop;
end $$;
