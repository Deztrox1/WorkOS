-- 0001_os_schema.sql  (WorkOS, 2026-10-13)
-- Tables live in `public` with an `os_` prefix so Supabase's REST API exposes them
-- without a dashboard change. The `outreach` schema is untouched.
-- Append-only: never edit this file after it is applied. Add 0002_*.sql instead.

create extension if not exists pgcrypto;

create or replace function public.os_touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ---------------------------------------------------------------- tasks
create table if not exists public.os_tasks (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  notes         text,
  area          text not null default 'work' check (area in ('work','personal')),
  status        text not null default 'open' check (status in ('open','done','dropped')),
  due_date      date,
  due_time      time,
  planned_for   date,                      -- the day the user plans to do it (evening planning)
  priority      smallint not null default 2 check (priority between 1 and 3),  -- 1 high
  est_minutes   integer,
  project       text,                      -- e.g. cold-email, northwind, acme, personal
  source        text not null default 'user',   -- user | idle_inventory | email | collector
  source_ref    text,                      -- stable id in the source (campaign id, thread id, row #)
  waiting_on    text,                      -- what it is waiting for (a yes, money, copy)
  next_action   text,                      -- the single next step
  cost_usd      numeric(10,2),             -- money the step needs, if any
  sort_order    integer not null default 0,
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists os_tasks_status_area_idx on public.os_tasks (status, area);
create index if not exists os_tasks_planned_idx on public.os_tasks (planned_for);
create index if not exists os_tasks_due_idx on public.os_tasks (due_date);
create trigger os_tasks_touch before update on public.os_tasks
  for each row execute function public.os_touch_updated_at();

-- ------------------------------------------------------------ reminders
create table if not exists public.os_reminders (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  notes         text,
  area          text not null default 'personal' check (area in ('work','personal')),
  remind_at     timestamptz,               -- first/next fire time (one-off or anchor for repeats)
  time_local    time,                      -- for repeating reminders (IST on device)
  repeat        text not null default 'none' check (repeat in ('none','daily','weekdays','weekly','monthly','custom')),
  repeat_days   smallint[] default '{}',   -- 0=Sun..6=Sat, used when repeat = 'custom' or 'weekly'
  active        boolean not null default true,
  last_fired_at timestamptz,
  task_id       uuid references public.os_tasks(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger os_reminders_touch before update on public.os_reminders
  for each row execute function public.os_touch_updated_at();

-- ----------------------------------------------------------------- days
-- One row per day: the morning plan and the evening review, in the user's words.
create table if not exists public.os_days (
  day           date primary key,
  plan          text,                      -- morning: what today is about
  review        text,                      -- evening: how it went
  top_task_ids  uuid[] default '{}',       -- the few tasks picked for the day
  mood          smallint check (mood between 1 and 5),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger os_days_touch before update on public.os_days
  for each row execute function public.os_touch_updated_at();

-- --------------------------------------------------------------- habits
create table if not exists public.os_habits (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  area          text not null default 'personal' check (area in ('work','personal')),
  days          smallint[] not null default '{0,1,2,3,4,5,6}',   -- which weekdays it applies
  time_local    time,
  active        boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);
create table if not exists public.os_habit_logs (
  habit_id      uuid not null references public.os_habits(id) on delete cascade,
  day           date not null,
  done          boolean not null default true,
  note          text,
  created_at    timestamptz not null default now(),
  primary key (habit_id, day)
);

-- --------------------------------------------------------------- events
-- The feed: anything a collector or agent wants the user to see. Read-mostly.
create table if not exists public.os_events (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,             -- campaign | reply | alert | lead | invoice | system | note
  title         text not null,
  body          text,
  severity      text not null default 'info' check (severity in ('info','good','warn','bad')),
  area          text not null default 'work' check (area in ('work','personal')),
  source        text,                      -- collector name
  url           text,
  occurred_at   timestamptz not null default now(),
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists os_events_occurred_idx on public.os_events (occurred_at desc);

-- --------------------------------------------------- campaign snapshots
-- One row per campaign per collector run. Charts and deltas come from here.
create table if not exists public.os_campaign_snapshots (
  id              bigint generated always as identity primary key,
  taken_at        timestamptz not null default now(),
  channel         text not null check (channel in ('email','sms')),
  account         text not null,           -- instantly | ghl-primary | ghl-brightpath
  campaign_id     text not null,
  campaign_name   text not null,
  status          text,                    -- active | paused | completed | draft | published
  sent_total      integer,
  replies_total   integer,
  positives_total integer,
  bounces_total   integer,
  opens_total     integer,
  leads_total     integer,
  raw             jsonb,
  unique (taken_at, account, campaign_id)
);
create index if not exists os_snap_campaign_idx on public.os_campaign_snapshots (account, campaign_id, taken_at desc);

-- Latest row per campaign, for the campaigns screen.
create or replace view public.os_campaigns_latest as
select distinct on (account, campaign_id) *
from public.os_campaign_snapshots
order by account, campaign_id, taken_at desc;

-- ------------------------------------------------------------- settings
create table if not exists public.os_settings (
  key           text primary key,
  value         jsonb not null,
  updated_at    timestamptz not null default now()
);

-- ----------------------------------------------------------------- RLS
-- Single-user app: any signed-in user may read and write everything; anon may not.
do $$
declare t text;
begin
  foreach t in array array['os_tasks','os_reminders','os_days','os_habits','os_habit_logs','os_events','os_campaign_snapshots','os_settings']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_authenticated_all', t);
    execute format('create policy %I on public.%I for all to authenticated using (true) with check (true)', t || '_authenticated_all', t);
  end loop;
end $$;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant select on public.os_campaigns_latest to authenticated;
