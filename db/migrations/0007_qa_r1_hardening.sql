-- 0007_qa_r1_hardening.sql  (WorkOS, 2026-10-28)
-- QA round 1 (logs/qa-r1-database.md D*, logs/qa-r1-security.md Q*). Append-only: never edit after it is applied.
--   1. The migration ledger is closed to app roles (D6).
--   2. os_claude_requests: status `firing`, attempts, seen_at, created_by, size checks, one open request per
--      task, owner-only inserts (D2, D18, Q2, Q4, Q5, Q6). This is the data contract in logs/qa-r1-plan.md.
--   3. View os_campaign_daily: last snapshot per campaign per IST day, 31 days, security_invoker (D1).
--   4. Policies evaluate os_is_owner() once per statement, not once per row (D10).
--   5. CHECKs on reminders, habits, finance, tasks (D17, D18), added NOT VALID and then validated.
--   6. Indexes (D19, D20), TRUNCATE/REFERENCES/TRIGGER revoked (D22), owner_uid guard (Q18),
--      top_task_ids cleanup on task delete (D18).
-- Retention (D8) is not here: the migration guard refuses DELETE in a migration, so it lives in
-- execution/collectors/retention.py, run by the hourly workos-collect Action.
-- Needs Postgres 15+ (security_invoker views; Supabase projects are 15 or 17).

-- ------------------------------------------------------------------ 1. ledger (D6)
-- apply.py creates public.os_schema_migrations before 0001 runs, and 0001 granted every public table to
-- authenticated. Only the migration role (the DB URL, which bypasses RLS) may touch it.
do $$
begin
  if to_regclass('public.os_schema_migrations') is not null then
    execute 'alter table public.os_schema_migrations enable row level security';
    execute 'revoke all on public.os_schema_migrations from anon, authenticated';
  end if;
end $$;

-- ------------------------------------------------------- 2. os_claude_requests (contract)
alter table public.os_claude_requests add column if not exists attempts integer not null default 0;
alter table public.os_claude_requests add column if not exists seen_at timestamptz;          -- owner saw the result
alter table public.os_claude_requests add column if not exists created_by uuid default auth.uid();

-- Status gains `firing` (claimed by claude_fire, POST in flight). The old inline check is swapped for a
-- wider one in ONE statement (apply.py allows DROP CONSTRAINT only when the same statement re-adds it).
alter table public.os_claude_requests
  drop constraint if exists os_claude_requests_status_check,
  add constraint os_claude_requests_status_check
    check (status in ('queued','firing','sent','done','failed','cancelled')) not valid;

alter table public.os_claude_requests
  add constraint os_claude_requests_brief_len check (length(brief) <= 20000) not valid,
  add constraint os_claude_requests_title_len check (length(title) <= 500) not valid,
  add constraint os_claude_requests_attempts_range check (attempts >= 0) not valid,
  add constraint os_claude_requests_sent_has_time check (status <> 'sent' or sent_at is not null) not valid;

-- One open request per task (Q5). Older duplicates are cancelled first so the index can be built:
-- a sent one wins, then firing, then the oldest queued.
with ranked as (
  select id, row_number() over (
           partition by task_id
           order by case status when 'sent' then 0 when 'firing' then 1 else 2 end, created_at) as rn
  from public.os_claude_requests
  where task_id is not null and status in ('queued','firing','sent')
)
update public.os_claude_requests r
   set status = 'cancelled', error = 'Duplicate of another open request for this task (cleaned up by migration 0007).'
  from ranked
 where ranked.id = r.id and ranked.rn > 1;

create unique index if not exists os_claude_requests_open_task_uq
  on public.os_claude_requests (task_id)
  where status in ('queued','firing','sent') and task_id is not null;
create index if not exists os_claude_requests_task_idx on public.os_claude_requests (task_id);

-- Owner-only inserts (Q2). created_by is always auth.uid() of the signed-in caller, whatever the client
-- sends, and must be the owner. A connection made with the DB URL has no auth.uid(), so a script holding
-- that URL cannot queue a brief by a plain insert. Updates never change created_by. Re-queueing a
-- finished request from the app starts its attempt count again.
create or replace function public.os_claude_requests_stamp() returns trigger
language plpgsql set search_path = '' as $$
declare
  owner text;
begin
  if tg_op = 'INSERT' then
    owner := (select s.value #>> '{}' from public.os_settings s where s.key = 'owner_uid');
    new.created_by := auth.uid();
    new.attempts := 0;
    if new.created_by is null or owner is null or new.created_by::text <> owner then
      raise exception 'Only the owner, signed in to the app, can queue a Claude request.' using errcode = '42501';
    end if;
  else
    new.created_by := old.created_by;
    if auth.uid() is not null and new.status = 'queued' and old.status <> 'queued' then
      new.attempts := 0;
    end if;
  end if;
  return new;
end $$;
create or replace trigger os_claude_requests_stamp before insert or update on public.os_claude_requests
  for each row execute function public.os_claude_requests_stamp();

-- Daily fire budget read by claude_fire.py (Q6). The owner can change the number; nothing resets it.
insert into public.os_settings (key, value) values ('claude_fire_budget', '20'::jsonb)
  on conflict (key) do nothing;

-- ---------------------------------------------------------------- 3. os_campaign_daily (D1)
-- One row per (account, campaign_id, IST day) for the last 31 IST days (today included): the last snapshot
-- of that day. The app reads it ordered by taken_at asc, limit 5000, instead of the raw snapshots.
create or replace view public.os_campaign_daily with (security_invoker = true) as
select distinct on (s.account, s.campaign_id, (s.taken_at at time zone 'Asia/Kolkata')::date)
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
 where s.taken_at >= (((now() at time zone 'Asia/Kolkata')::date - 30)::timestamp at time zone 'Asia/Kolkata')
 order by s.account, s.campaign_id, (s.taken_at at time zone 'Asia/Kolkata')::date, s.taken_at desc;
revoke all on public.os_campaign_daily from anon;
grant select on public.os_campaign_daily to authenticated;
create index if not exists os_snap_taken_idx on public.os_campaign_snapshots (taken_at);

-- ------------------------------------------------------------------- 4. policies (D10)
-- `(select f())` is an initplan: evaluated once per statement instead of once per row.
alter policy os_tasks_owner_all on public.os_tasks
  using ((select public.os_is_owner())) with check ((select public.os_is_owner()));
alter policy os_reminders_owner_all on public.os_reminders
  using ((select public.os_is_owner())) with check ((select public.os_is_owner()));
alter policy os_days_owner_all on public.os_days
  using ((select public.os_is_owner())) with check ((select public.os_is_owner()));
alter policy os_habits_owner_all on public.os_habits
  using ((select public.os_is_owner())) with check ((select public.os_is_owner()));
alter policy os_habit_logs_owner_all on public.os_habit_logs
  using ((select public.os_is_owner())) with check ((select public.os_is_owner()));
alter policy os_events_owner_all on public.os_events
  using ((select public.os_is_owner())) with check ((select public.os_is_owner()));
alter policy os_campaign_snapshots_owner_all on public.os_campaign_snapshots
  using ((select public.os_is_owner())) with check ((select public.os_is_owner()));
alter policy os_settings_owner_all on public.os_settings
  using ((select public.os_is_owner())) with check ((select public.os_is_owner()));
alter policy os_notes_owner_all on public.os_notes
  using ((select public.os_is_owner())) with check ((select public.os_is_owner()));
alter policy os_finance_entries_owner_all on public.os_finance_entries
  using ((select public.os_is_owner())) with check ((select public.os_is_owner()));
alter policy os_push_subscriptions_owner_all on public.os_push_subscriptions
  using ((select public.os_is_owner())) with check ((select public.os_is_owner()));
alter policy os_sms_days_owner_all on public.os_sms_days
  using ((select public.os_is_owner())) with check ((select public.os_is_owner()));
alter policy os_claude_requests_owner_all on public.os_claude_requests
  using ((select public.os_is_owner())) with check ((select public.os_is_owner()));

-- ------------------------------------------------------------------- 5. checks (D17, D18)
-- A done task with no completed_at gets its last update time, so the new rule validates.
update public.os_tasks set completed_at = updated_at where status = 'done' and completed_at is null;

alter table public.os_reminders
  add constraint os_reminders_repeat_days_range check (repeat_days <@ '{0,1,2,3,4,5,6}'::smallint[]) not valid,
  add constraint os_reminders_one_off_has_time check (repeat <> 'none' or remind_at is not null) not valid;
alter table public.os_habits
  add constraint os_habits_days_range check (days <@ '{0,1,2,3,4,5,6}'::smallint[]) not valid;
alter table public.os_finance_entries
  add constraint os_finance_month_first check (month = date_trunc('month', month)::date) not valid,
  add constraint os_finance_end_month check (end_month is null or (end_month >= month and end_month = date_trunc('month', end_month)::date)) not valid,
  add constraint os_finance_currency check (currency in ('USD','INR','GBP')) not valid;
alter table public.os_tasks
  add constraint os_tasks_est_minutes_nonneg check (est_minutes is null or est_minutes >= 0) not valid,
  add constraint os_tasks_cost_nonneg check (cost_usd is null or cost_usd >= 0) not valid,
  add constraint os_tasks_done_has_time check (status <> 'done' or completed_at is not null) not valid;

-- Validate every new check. A NOT VALID check already guards every new write; if old rows break one, the
-- migration still applies, prints a notice naming it, and leaves only that check unvalidated.
do $$
declare c record;
begin
  for c in select * from (values
      ('os_claude_requests', 'os_claude_requests_status_check'),
      ('os_claude_requests', 'os_claude_requests_brief_len'),
      ('os_claude_requests', 'os_claude_requests_title_len'),
      ('os_claude_requests', 'os_claude_requests_attempts_range'),
      ('os_claude_requests', 'os_claude_requests_sent_has_time'),
      ('os_reminders', 'os_reminders_repeat_days_range'),
      ('os_reminders', 'os_reminders_one_off_has_time'),
      ('os_habits', 'os_habits_days_range'),
      ('os_finance_entries', 'os_finance_month_first'),
      ('os_finance_entries', 'os_finance_end_month'),
      ('os_finance_entries', 'os_finance_currency'),
      ('os_tasks', 'os_tasks_est_minutes_nonneg'),
      ('os_tasks', 'os_tasks_cost_nonneg'),
      ('os_tasks', 'os_tasks_done_has_time')
    ) v(t, n)
  loop
    begin
      execute format('alter table public.%I validate constraint %I', c.t, c.n);
    exception when check_violation then
      raise notice '% on % left NOT VALID: existing rows break it (new writes are still checked)', c.n, c.t;
    end;
  end loop;
end $$;

-- A hard-deleted task leaves no dangling id in os_days.top_task_ids (D18).
create or replace function public.os_tasks_forget_deleted() returns trigger
language plpgsql set search_path = '' as $$
begin
  update public.os_days set top_task_ids = array_remove(top_task_ids, old.id)
   where old.id = any(top_task_ids);
  return old;
end $$;
create or replace trigger os_tasks_forget_deleted after delete on public.os_tasks
  for each row execute function public.os_tasks_forget_deleted();

-- ------------------------------------------------------------------- 6. indexes (D19, D20)
create index if not exists os_events_source_title_idx on public.os_events (source, title, occurred_at desc);
create index if not exists os_events_bad_unpushed_idx on public.os_events (occurred_at desc)
  where severity = 'bad' and read_at is null and pushed_at is null;
create index if not exists os_reminders_task_idx on public.os_reminders (task_id);

-- --------------------------------------------------------------- 7. privileges (D22)
-- TRUNCATE ignores RLS. PostgREST cannot issue it today, but no future RPC or SQL path should either.
revoke truncate, references, trigger on all tables in schema public from authenticated;
alter default privileges in schema public revoke truncate, references, trigger on tables from authenticated;

-- ------------------------------------------------------------- 8. owner_uid guard (Q18)
-- A signed-in session (even the owner's) can no longer insert, change or delete os_settings.owner_uid,
-- so a hijacked session cannot lock the owner out or hand the app to someone else. Only a connection
-- with no auth.uid() (the DB URL, i.e. a migration) can change it.
create or replace function public.os_guard_owner_uid() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and (
       (tg_op in ('UPDATE', 'DELETE') and old.key = 'owner_uid')
    or (tg_op in ('INSERT', 'UPDATE') and new.key = 'owner_uid')) then
    raise exception 'owner_uid cannot be changed from the app.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;
create or replace trigger os_settings_guard_owner_uid before insert or update or delete on public.os_settings
  for each row execute function public.os_guard_owner_uid();

revoke all on function public.os_claude_requests_stamp() from public, anon;
revoke all on function public.os_tasks_forget_deleted() from public, anon;
revoke all on function public.os_guard_owner_uid() from public, anon;
