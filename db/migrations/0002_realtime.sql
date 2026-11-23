-- 0002_realtime.sql  (WorkOS, 2026-10-17)
-- Realtime only streams tables that are in the supabase_realtime publication. 0001 created the tables
-- but never added them, so the app's subscriptions would receive nothing (PRD QA round 1, item 20).
-- Idempotent: skips a table that is already in the publication.
do $$
declare t text;
begin
  foreach t in array array['os_events','os_campaign_snapshots']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
