-- 0010_calendar.sql  (WorkOS, 2026-11-07)
-- Round 4: Google Calendar both ways (logs/qa-r4-plan.md, data contract). Append-only: never edit after it is applied.
--   1. os_calendar_events: mirror of the primary calendar, today-1 to today+3, one row per instance of a repeat.
--   2. os_calendar_links: task <-> event. No foreign key: a deleted task must still find its event. The app never reads it.
--   3. os_calendar_state: one row, the link's status line and the day's counts.
-- All three are written only by execution/push/gcal_sync.py over the DB URL. The app reads the mirror and the state and
-- nothing else: Supabase default privileges hand a new table to anon and authenticated, so each one is revoked first.

-- ------------------------------------------------------------- 1. the mirror
create table public.os_calendar_events (
  id           text primary key,
  title        text not null default '',
  starts_at    timestamptz,
  ends_at      timestamptz,
  all_day_from date,
  all_day_to   date,                                -- exclusive, as Google gives it
  busy         boolean not null default true,       -- false when Google marks it Free
  html_link    text,
  meet_link    text,
  task_id      uuid,                                -- set when this event is the copy of a task
  synced_at    timestamptz not null default now(),
  constraint os_calendar_events_html_link_host check (html_link is null or html_link ~ '^https://www\.google\.com/calendar/'),
  constraint os_calendar_events_meet_link_host check (meet_link is null or meet_link ~ '^https://meet\.google\.com/[a-z]{3}-[a-z]{4}-[a-z]{3}(\?[a-z0-9=&_-]*)?$'),
  constraint os_calendar_events_when check (
    (starts_at is not null and ends_at is not null and all_day_from is null and all_day_to is null)
    or (all_day_from is not null and all_day_to is not null and starts_at is null and ends_at is null))
);
create index os_calendar_events_starts_idx on public.os_calendar_events (starts_at);
create index os_calendar_events_all_day_idx on public.os_calendar_events (all_day_from);
alter table public.os_calendar_events enable row level security;
revoke all on public.os_calendar_events from anon, authenticated;
create policy os_calendar_events_owner_read on public.os_calendar_events
  for select to authenticated using ((select public.os_is_owner()));
grant select on public.os_calendar_events to authenticated;

-- -------------------------------------------------------------- 2. the links
create table public.os_calendar_links (
  task_id    uuid primary key,
  event_id   text not null unique,
  sig        text not null,                         -- title|due_date|due_time|minutes at the last agreement
  checked_at timestamptz,                           -- last direct read of an event the list did not hold
  released_at timestamptz,                          -- the event got guests or a repeat: left alone for good
  created_at timestamptz not null default now()
);
alter table public.os_calendar_links enable row level security;
revoke all on public.os_calendar_links from anon, authenticated;
-- No select grant: the policy is here because every table carries an owner policy, but no app session can read this table.
create policy os_calendar_links_owner_read on public.os_calendar_links
  for select to authenticated using ((select public.os_is_owner()));

-- -------------------------------------------------------------- 3. the state
create table public.os_calendar_state (
  id         boolean primary key default true check (id),
  linked     boolean not null default false,
  last_ok_at timestamptz,
  problem    text,                                  -- plain words for the owner, null when fine
  counted_on date,                                  -- the IST day the two counts below belong to
  clears_today integer not null default 0,          -- tasks that lost their time to Google today (cap 10)
  writes_today integer not null default 0,          -- changes made on Google today (cap 200)
  updated_at timestamptz not null default now()
);
alter table public.os_calendar_state enable row level security;
revoke all on public.os_calendar_state from anon, authenticated;
create policy os_calendar_state_owner_read on public.os_calendar_state
  for select to authenticated using ((select public.os_is_owner()));
grant select on public.os_calendar_state to authenticated;
insert into public.os_calendar_state (id) values (true) on conflict (id) do nothing;
