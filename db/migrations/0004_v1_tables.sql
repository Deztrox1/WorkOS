-- 0004_v1_tables.sql  (WorkOS v1, 2026-10-22)
-- PRD v3 section 1 "Migration 0004". pg_net, Vault and pg_cron are skipped on purpose:
-- push-due runs as a systemd timer on the VPS (PRD section 2), not as an Edge Function.
-- Append-only: never edit this file after it is applied.

-- ---------------------------------------------------------------- notes
create table if not exists public.os_notes (
  id          uuid primary key default gen_random_uuid(),
  title       text not null default '',
  body        text not null default '',
  area        text not null default 'work' check (area in ('work','personal')),
  pinned      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists os_notes_order_idx on public.os_notes (pinned desc, updated_at desc);
create trigger os_notes_touch before update on public.os_notes
  for each row execute function public.os_touch_updated_at();

-- ------------------------------------------------------ finance entries
create table if not exists public.os_finance_entries (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('cost','revenue')),
  label       text not null,
  amount      numeric(12,2) not null,
  currency    text not null default 'USD',
  recurrence  text not null default 'one_time' check (recurrence in ('monthly','one_time')),
  month       date not null,               -- first day of the month (start month for a monthly cost)
  end_month   date,                        -- last month a monthly cost applies ("end a recurring cost")
  source      text not null default 'manual',   -- seed | manual | ledger
  source_ref  text,                        -- e.g. invoice number for source = ledger
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists os_finance_source_uq
  on public.os_finance_entries (source, source_ref) where source_ref is not null;
create index if not exists os_finance_month_idx on public.os_finance_entries (month);
create trigger os_finance_touch before update on public.os_finance_entries
  for each row execute function public.os_touch_updated_at();

-- ------------------------------------------------- push subscriptions
create table if not exists public.os_push_subscriptions (
  endpoint      text primary key,
  p256dh        text not null,
  auth          text not null,
  device_label  text,
  created_at    timestamptz not null default now()
);

-- ------------------------------------------------------------ SMS days
create table if not exists public.os_sms_days (
  day         date not null,
  account     text not null,
  sent        integer,
  replies     integer,
  positives   integer,
  negatives   integer,
  stops       integer,
  capped      boolean not null default false,
  created_at  timestamptz not null default now(),
  primary key (day, account)
);

-- ------------------------------------------------- push bookkeeping
alter table public.os_events add column if not exists pushed_at timestamptz;
update public.os_events set pushed_at = now() where pushed_at is null;   -- no old alert is pushed
alter table public.os_tasks add column if not exists pushed_at timestamptz;
alter table public.os_habits add column if not exists last_pushed_on date;

-- one row per source reference (collectors and intake upsert on this)
create unique index if not exists os_tasks_source_ref_uq
  on public.os_tasks (source, source_ref) where source_ref is not null;

-- ------------------------------------------------------------ settings
insert into public.os_settings(key, value) values
  ('profit_target', '1000'::jsonb),
  ('fx', '{"USD":1,"INR":0.0119,"GBP":1.3}'::jsonb)
on conflict (key) do nothing;

-- ----------------------------------------------------------------- RLS
do $$
declare t text;
begin
  foreach t in array array['os_notes','os_finance_entries','os_push_subscriptions','os_sms_days']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_authenticated_all', t);
    execute format('create policy %I on public.%I for all to authenticated using (true) with check (true)', t || '_authenticated_all', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
