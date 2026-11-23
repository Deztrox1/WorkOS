"""Unit tests for the migration guard in db/apply.py (QA r1 D16, Q11, Q12). No database needed.
Run: /tmp/wos-venv/bin/python -m pytest db/tests/test_apply_lint.py -q
"""
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import apply  # noqa: E402

MIG = HERE.parent / "migrations"
OWNER_TABLE = """
create table if not exists public.os_x (id uuid primary key);
alter table public.os_x enable row level security;
create policy os_x_owner_all on public.os_x for all to authenticated
  using ((select public.os_is_owner())) with check ((select public.os_is_owner()));
grant select, insert on public.os_x to authenticated;
"""


def reasons(sql):
    return apply.forbidden_reasons(sql)


# ------------------------------------------------------------------ the real files
def test_0007_is_grandfathered_because_it_creates_the_guards():
    # 0007 creates the guard functions and the owner_uid trigger that the 2026-10-29 rules protect.
    assert apply.lint_file(MIG / "0007_qa_r1_hardening.sql") == []
    assert "redefines a guard function" in reasons((MIG / "0007_qa_r1_hardening.sql").read_text())


def test_0008_passes():
    assert reasons((MIG / "0008_qa_r2_hardening.sql").read_text()) == []


def test_0010_passes():
    assert apply.lint_file(MIG / "0010_calendar.sql") == []
    assert reasons((MIG / "0010_calendar.sql").read_text()) == []


def test_calendar_tables_are_read_only_for_the_app_in_the_pins():
    tables = {"os_calendar_events", "os_calendar_links", "os_calendar_state"}
    assert tables - {"os_calendar_links"} <= apply.AUTH_SELECT_ONLY
    assert "os_calendar_links" in apply.AUTH_NONE and "os_calendar_links" not in apply.AUTH_SELECT_ONLY     # the app has no reason to read it
    assert {(t, f"{t}_owner_read") for t in tables} <= apply.PINNED_READ_ONLY_POLICIES
    assert set(apply.PINNED_CONSTRAINTS_FROM) == {"os_calendar_events_html_link_host", "os_calendar_events_meet_link_host"}
    assert set(apply.PINNED_CONSTRAINTS_FROM) <= set(apply.PINNED_CONSTRAINTS)


def test_0010_grants_nothing_on_the_links_and_pins_the_meet_code():
    sql = (MIG / "0010_calendar.sql").read_text()
    assert "grant select on public.os_calendar_links" not in sql and "grant select on public.os_calendar_events" in sql
    pin = r"meet\.google\.com/[a-z]{3}-[a-z]{4}-[a-z]{3}"
    assert pin in sql and pin in apply.PINNED_CONSTRAINTS["os_calendar_events_meet_link_host"]


def test_restore_gives_the_links_nothing():
    sql = (HERE.parent / "restore/post_restore.sql").read_text()
    read_only = sql.split("Read-only for the owner")[1].split("end $$")[0]
    assert "'os_calendar_events'" in read_only and "'os_calendar_links'" not in read_only.split("for r in")[1]
    assert "'os_calendar_links'" in sql.split("Read-only for the owner")[0]      # kept out of the read and write list too


# ------------------------------------------------------------------ R4B13: a late file with an old number
@pytest.mark.parametrize("pending,applied,refused", [
    (["0008_later.sql"], {"0009_a.sql": "x", "0010_b.sql": "x"}, ["0008_later.sql"]),
    (["0010_other.sql"], {"0010_b.sql": "x"}, ["0010_other.sql"]),                       # the same number
    (["0011_next.sql"], {"0009_a.sql": "x", "0010_b.sql": "x"}, []),
    (["0001_a.sql", "0002_b.sql"], {}, []),                                              # a fresh database
    (["0009_a.sql", "0011_b.sql"], {"0010_c.sql": "x"}, ["0009_a.sql"]),
])
def test_a_pending_file_at_or_below_the_highest_applied_is_refused(pending, applied, refused):
    assert apply.numbered_too_low(pending, applied) == refused


def test_applied_files_would_fail_new_rules_which_is_why_only_pending_files_are_linted():
    # 0001 and 0005 drop policies inside execute format('...'); 0001 grants ON ALL TABLES to authenticated.
    assert "DROP" in reasons((MIG / "0001_os_schema.sql").read_text())
    assert "DROP" in reasons((MIG / "0005_owner_lock.sql").read_text())
    assert "GRANT ON ALL ... TO authenticated" in reasons((MIG / "0001_os_schema.sql").read_text())


# ------------------------------------------------------------------ dynamic SQL (D16a)
def test_drop_inside_execute_is_caught():
    assert "DROP" in reasons("do $$ begin execute 'drop table public.os_tasks'; end $$;")
    assert "DROP" in reasons("do $$ begin execute format('drop policy %I on public.os_tasks', 'p'); end $$;")


def test_data_literals_stay_data():
    assert reasons("insert into public.os_settings(key, value) values ('note', '\"drop table x\"'::jsonb) on conflict (key) do nothing;") == []
    assert reasons("comment on table public.os_tasks is 'never DROP this';") == []


def test_comments_are_ignored():
    assert reasons("-- drop table x\n/* truncate y */ select 1;") == []


# ------------------------------------------------------------------ constraint swap
def test_constraint_swap_in_one_statement_is_allowed():
    sql = """alter table public.os_t drop constraint if exists os_t_status_check,
             add constraint os_t_status_check check (status in ('a','b')) not valid;"""
    assert reasons(sql) == []


def test_plain_drop_constraint_is_refused():
    assert "DROP" in reasons("alter table public.os_t drop constraint os_t_status_check;")


def test_swap_split_over_two_statements_is_refused():
    sql = """alter table public.os_t drop constraint os_t_c;
             alter table public.os_t add constraint os_t_c check (true);"""
    assert "DROP" in reasons(sql)


def test_swap_with_a_different_name_is_refused():
    sql = "alter table public.os_t drop constraint os_t_a, add constraint os_t_b check (x > 0);"
    assert "DROP" in reasons(sql)


# ------------------------------------------------------------------ UPDATE without WHERE (D16b)
@pytest.mark.parametrize("sql", [
    "update public.os_tasks set title = 'x';",
    "update only public.os_tasks set title = 'x';",
    "update public.os_tasks as t set title = 'x';",
    "update public.os_tasks t set title = 'x';",
    "with s as (select id from public.os_tasks where status = 'open') update public.os_tasks set title = 'x';",
    "do $$ begin update public.os_tasks set title = 'x'; end $$;",
])
def test_update_without_where_is_refused(sql):
    assert "UPDATE without WHERE" in reasons(sql)


@pytest.mark.parametrize("sql", [
    "update public.os_tasks set title = 'x' where id is null;",
    "update public.os_tasks t set title = 'x' from public.os_days d where d.day = t.due_date;",
    "insert into public.os_settings(key,value) values ('a','1'::jsonb) on conflict (key) do update set value = excluded.value;",
    "create trigger t before insert or update on public.os_tasks for each row execute function public.f();",
])
def test_update_with_where_or_not_an_update_passes(sql):
    assert "UPDATE without WHERE" not in reasons(sql)


# ------------------------------------------------------------------ access rules (D16c, Q11)
def test_using_true_is_refused():
    assert "USING (true) / WITH CHECK (true)" in reasons("create policy p on public.os_x for all to authenticated using (true);")
    assert "USING (true) / WITH CHECK (true)" in reasons("alter policy p on public.os_x with check ( true );")


def test_policy_must_call_os_is_owner():
    assert any("without os_is_owner" in r for r in reasons("alter policy p on public.os_x using (auth.uid() is not null);"))
    assert reasons("alter policy p on public.os_x using ((select public.os_is_owner()));") == []


def test_os_is_owner_cannot_be_redefined_or_altered():
    assert "redefines os_is_owner" in reasons(
        "create or replace function public.os_is_owner() returns boolean language sql set search_path = '' as $$ select true $$;")
    assert "alters os_is_owner" in reasons("alter function public.os_is_owner() security invoker;")


def test_security_definer_needs_search_path():
    bad = "create function public.f() returns int language sql security definer as $$ select 1; $$;"
    good = "create function public.f() returns int language sql security definer set search_path = '' as $$ select 1; $$;"
    assert "SECURITY DEFINER without SET search_path" in reasons(bad)
    assert "SECURITY DEFINER without SET search_path" not in reasons(good)


def test_grant_to_authenticated_only_on_objects_created_here():
    assert reasons(OWNER_TABLE) == []
    assert "GRANT ... TO authenticated on an object this file did not create" in reasons(
        "grant select on public.os_tasks to authenticated;")
    assert "GRANT ON ALL ... TO authenticated" in reasons("grant select on all tables in schema public to authenticated;")


def test_grant_to_anon_is_refused():
    assert "GRANT ... TO anon/public" in reasons("grant select on public.os_x to anon;")


# ------------------------------------------------------------------ structure rules
def test_new_table_needs_rls_and_owner_policy():
    r = reasons("create table public.os_y (id int primary key);")
    assert "table os_y without ENABLE ROW LEVEL SECURITY" in r
    assert "table os_y without an os_is_owner() policy" in r
    r = reasons("create table public.os_y (id int primary key); alter table public.os_y enable row level security;")
    assert r == ["table os_y without an os_is_owner() policy"]


def test_temp_tables_are_exempt():
    assert reasons("create temp table scratch (id int);") == []


def test_view_needs_security_invoker():
    assert "view os_v without security_invoker" in reasons("create or replace view public.os_v as select 1 as x;")
    assert reasons("create or replace view public.os_v with (security_invoker = true) as select 1 as x;") == []


# ------------------------------------------------------------------ destructive basics (unchanged)
@pytest.mark.parametrize("sql,label", [
    ("drop table public.os_tasks;", "DROP"),
    ("alter table public.os_tasks drop column notes;", "DROP"),
    ("truncate public.os_tasks;", "TRUNCATE"),
    ("delete from public.os_tasks where true;", "DELETE FROM"),
    ("alter table public.os_tasks rename to x;", "RENAME"),
    ("alter table public.os_tasks alter column title type varchar(9);", "ALTER COLUMN ... TYPE"),
    ("alter table public.os_tasks disable row level security;", "DISABLE ROW LEVEL SECURITY"),
])
def test_destructive_still_refused(sql, label):
    assert label in reasons(sql)


# ------------------------------------------------------------------ project guard (Q12)
def test_is_workos():
    ref = apply.PROJECT_REF
    assert apply.is_workos(f"postgresql://postgres.{ref}:pw@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres")
    assert apply.is_workos(f"postgresql://postgres:pw@db.{ref}.supabase.co:5432/postgres")
    assert not apply.is_workos("postgresql://postgres.otherproject:pw@aws-0.pooler.supabase.com:5432/postgres")
    # the ref hidden in a password does not count
    assert not apply.is_workos(f"postgresql://postgres.other:{ref}@host:5432/postgres")


def test_no_cold_email_fallback():
    assert all("Cold Email" not in str(p) for p in apply.ENV_FALLBACKS)


def test_revoke_truncate_is_fine_but_grant_or_run_is_not():
    assert reasons("revoke truncate, references, trigger on all tables in schema public from authenticated;") == []
    assert reasons("alter default privileges in schema public revoke truncate on tables from authenticated;") == []
    assert "TRUNCATE" in reasons("grant truncate on public.os_x to service_role;")
    assert "TRUNCATE" in reasons("do $$ begin truncate public.os_tasks; end $$;")


def test_grandfathered_files_pass_only_while_unchanged(tmp_path):
    for f in sorted(MIG.glob("000[1-6]_*.sql")):
        assert apply.lint_file(f) == [], f.name
    edited = tmp_path / "0001_os_schema.sql"
    edited.write_text((MIG / "0001_os_schema.sql").read_text() + "\n-- edited\n")
    assert "DROP" in apply.lint_file(edited)


def test_every_migration_on_disk_passes_lint_as_a_fresh_bootstrap_would_see_it():
    for f in sorted(MIG.glob("[0-9][0-9][0-9][0-9]_*.sql")):
        assert apply.lint_file(f) == [], f.name


# ------------------------------------------------------------------ QA r2 R2S06 / R2D06: switching the guards off
GUARD_ATTACKS = {
    "alter table public.os_settings disable trigger os_settings_guard_owner_uid;": "DISABLE TRIGGER",
    "do $$ begin execute 'alter table public.os_claude_requests disable trigger all'; end $$;": "DISABLE TRIGGER",
    "set session_replication_role = replica;": "session_replication_role",
    "create or replace function public.os_guard_owner_uid() returns trigger language plpgsql set search_path = '' as $$ begin return new; end $$;":
        "redefines a guard function",
    "create or replace function os_claude_requests_stamp() returns trigger language plpgsql as $$ begin return new; end $$;":
        "redefines a guard function",
    "create or replace function public.os_claude_requests_lock() returns trigger language plpgsql as $$ begin return new; end $$;":
        "redefines a guard function",
    "alter function public.os_guard_server_keys() owner to postgres;": "redefines a guard function",
    "create or replace trigger os_claude_requests_lock before update on public.os_claude_requests for each row execute function public.os_touch_updated_at();":
        "redefines a guard trigger",
    "update public.os_settings set value = '\"x\"' where key = 'owner_uid';": "mentions owner_uid",
    "insert into public.os_settings (key, value) values ('owner_uid', '\"x\"') on conflict (key) do update set value = excluded.value;":
        "mentions owner_uid",
    "alter policy os_tasks_owner_all on public.os_tasks using ((select public.os_is_owner()) or true);": "policy on os_tasks uses OR",
    "alter policy os_tasks_owner_all on public.os_tasks to anon, authenticated using ((select public.os_is_owner()));":
        "policy on os_tasks for a role other than authenticated",
    "create policy p on public.os_tasks for select using ((select public.os_is_owner()));": "policy on os_tasks without TO (defaults to public)",
    "create function public.os_leak() returns setof public.os_notes language sql security definer set search_path = public as $$ select 1 $$;":
        "SECURITY DEFINER os_leak without REVOKE ... FROM public",
    ("create function public.os_leak() returns setof public.os_notes language sql security definer set search_path = public as $$ select 1 $$;"
     " revoke all on function public.os_leak() from public; grant execute on function public.os_leak() to authenticated;"):
        "GRANT EXECUTE to authenticated on SECURITY DEFINER os_leak",
}


@pytest.mark.parametrize("sql,label", list(GUARD_ATTACKS.items()))
def test_guard_attacks_are_refused(sql, label):
    assert label in reasons(sql)


def test_guard_names_inside_longer_names_and_comments_are_fine():
    assert reasons("revoke execute on function public.os_guard_owner_uid() from authenticated;") == []
    assert reasons("-- owner_uid is never touched here\nselect 1;") == []
    assert reasons("create function public.os_x() returns int language sql security definer set search_path = public as $$ select 1 $$;"
                   " revoke all on function public.os_x() from public, anon, authenticated;") == []
