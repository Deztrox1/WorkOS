-- Throwaway-DB shim for the Supabase pieces the migrations expect (roles, auth.uid(), the realtime
-- publication). For db/tests/throwaway_apply.py and the restore drill in db/README.md. NEVER run it against
-- a real Supabase project: those objects already exist there.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  -- PostgREST logs in as authenticator and switches to authenticated per request (0008 checks session_user).
  if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator nologin noinherit; end if;
end $$;
grant anon, authenticated to authenticator;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
create publication supabase_realtime;
