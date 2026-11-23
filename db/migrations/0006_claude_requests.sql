-- 0006_claude_requests.sql  (WorkOS, 2026-10-27)
-- A queue of requests handed to Claude Code from the app. The app inserts (status queued); the VPS
-- poller (execution/push/claude_fire.py) fires the user's Claude Code routine and sets status sent plus
-- the session link; the routine (or the user) marks it done. Also: os_events.url may only hold https or
-- in-app links (security audit 2026-10-27, finding 13), and os_touch_updated_at pins its search_path.
create table if not exists public.os_claude_requests (
  id uuid primary key default gen_random_uuid(),
  area text not null check (area in ('work','personal')),
  task_id uuid references public.os_tasks(id) on delete set null,
  title text not null,
  brief text not null,
  status text not null default 'queued' check (status in ('queued','sent','done','failed','cancelled')),
  session_url text check (session_url is null or session_url ~ '^https://'),
  result text,
  error text,
  sent_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists os_claude_requests_status_idx on public.os_claude_requests (status, created_at);
create trigger os_claude_requests_touch before update on public.os_claude_requests
  for each row execute function public.os_touch_updated_at();

alter table public.os_claude_requests enable row level security;
revoke all on public.os_claude_requests from anon;
create policy os_claude_requests_owner_all on public.os_claude_requests
  for all to authenticated using (public.os_is_owner()) with check (public.os_is_owner());
grant select, insert, update, delete on public.os_claude_requests to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'os_claude_requests') then
    execute 'alter publication supabase_realtime add table public.os_claude_requests';
  end if;
end $$;

alter table public.os_events add constraint os_events_url_scheme check (url is null or url ~ '^(https://|/)');

create or replace function public.os_touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;
