-- 0003_lock_anon.sql  (WorkOS, 2026-10-17)
-- PRD QA round 2, item 9: Supabase default privileges grant new public objects to anon, and a plain view
-- runs as its owner and ignores RLS. Close both: the view runs as the caller, anon loses every grant on
-- public tables, sequences and functions, and future objects stop being granted to anon.
alter view public.os_campaigns_latest set (security_invoker = true);
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;
