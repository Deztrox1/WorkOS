-- post_restore.sql (WorkOS, QA r2 D05)
-- Run ONCE, after the schema and the data are restored into a NEW Supabase project, as the project's
-- `postgres` role (the DB URL). The backup is `pg_dump --no-privileges`, so it carries no grants, no realtime
-- membership and no owner id. This file puts back what migrations 0001, 0003, 0004, 0006, 0007 and 0008 did.
-- Idempotent. Re-running it is safe.
--
--   psql "$NEW_URL" -v ON_ERROR_STOP=1 -v new_owner_uid='<uuid of the owner in the NEW project's auth.users>' \
--        -f db/restore/post_restore.sql
--
-- It also needs the new owner's uid: sign in to the new project once (or create the user in the dashboard),
-- then `select id from auth.users where email = '<owner email>'`.
\set ON_ERROR_STOP on
begin;

-- ---- 1. grants (0001, 0003, 0004, 0006, 0007, 0008)
-- A new Supabase project hands anon and authenticated everything in public by default. Start from nothing.
grant usage on schema public to anon, authenticated;
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public revoke truncate, references, trigger on tables from authenticated;
alter default privileges in schema public revoke execute on functions from public, authenticated;

do $$
declare r record;
begin
  -- Ordinary tables: the app reads and writes them (RLS, restored with the schema, decides which rows).
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'os\_%'
              and c.relname not in ('os_schema_migrations', 'os_claude_fires',
                                    'os_calendar_events', 'os_calendar_links', 'os_calendar_state')
  loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', r.relname);
  end loop;
  -- Read-only for the owner: the ledger of fires, the calendar mirror and state (0010), the daily and baseline views, the
  -- latest-campaign view. os_calendar_links gets nothing: the app never reads it.
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname like 'os\_%'
              and (c.relkind = 'v' or c.relname in ('os_claude_fires', 'os_calendar_events', 'os_calendar_state'))
  loop
    execute format('grant select on public.%I to authenticated', r.relname);
  end loop;
  -- os_schema_migrations: only the DB URL touches it (0007). Nothing granted.
end $$;
grant usage, select on all sequences in schema public to authenticated;

-- Every policy calls os_is_owner(); trigger functions need no EXECUTE at fire time (0005, 0007, 0008).
grant execute on function public.os_is_owner() to authenticated;

-- Views must run as the caller, or they ignore RLS (0003, 0007, 0008).
do $$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'v' and c.relname like 'os\_%'
  loop
    execute format('alter view public.%I set (security_invoker = true)', r.relname);
  end loop;
end $$;

-- ---- 2. realtime (0002, 0006): the three tables the app listens to
do $$
declare t text;
begin
  foreach t in array array['os_events', 'os_campaign_snapshots', 'os_claude_requests']
  loop
    if to_regclass('public.' || t) is not null and not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---- 3. owner id (0005, 0007): the restored value names the OLD project's user
-- Allowed here because this session has no auth.uid() (the 0007 guard only stops app sessions).
update public.os_settings set value = to_jsonb(:'new_owner_uid'::text), updated_at = now() where key = 'owner_uid';
-- Exactly one row must have changed, or the app will show nothing.
do $$
begin
  if (select count(*) from public.os_settings where key = 'owner_uid') <> 1 then
    raise exception 'os_settings has no owner_uid row; insert it by hand before going on';
  end if;
end $$;

commit;
