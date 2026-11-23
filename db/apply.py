#!/usr/bin/env python3
"""
Apply the WorkOS migrations (db/migrations/NNNN_*.sql) to Supabase, once each,
one transaction per file, and refuse to run if an applied file's contents changed.

    python3 apply.py              # dry run: lists pending, touches nothing
    python3 apply.py --dry-run    # same
    python3 apply.py --apply      # apply pending

URL: SUPABASE_DB_URL from the environment, else `WF - WorkOS/.env` (parsed directly). There is no
fallback to `WF - Cold Email/.env`: that file points at a different Supabase project (QA r1 Q12).
--apply refuses a URL that does not name the WorkOS project ref (env WORKOS_PROJECT_REF, default
yourprojectref). Use the session pooler / direct URL (port 5432).
A pending file numbered at or below the highest applied one is refused, whatever it contains (QA r4 R4B13).
Ledger: public.os_schema_migrations(filename, sha256, applied_at). One apply at a time (advisory lock).
Requires: pip install "psycopg[binary]".

The guard lints PENDING files only (an applied file is immutable anyway); 0001-0006 are exempt while
byte-identical to the versions in GRANDFATHERED (they predate the 2026-10-28 rules). Refused, outside comments:
  destructive  DROP (except a constraint swap: `DROP CONSTRAINT [IF EXISTS] c` inside the same ALTER TABLE
               statement that re-adds `ADD CONSTRAINT c`), TRUNCATE (REVOKE TRUNCATE is fine), DELETE FROM, RENAME,
               ALTER COLUMN ... TYPE, UPDATE without WHERE (also UPDATE ONLY, aliases, CTE updates)
  access       DISABLE ROW LEVEL SECURITY, GRANT ... TO anon/public, ALTER ... OWNER TO,
               USING (true) / WITH CHECK (true), a CREATE/ALTER POLICY that does not call os_is_owner(),
               redefining or altering os_is_owner, SECURITY DEFINER without SET search_path,
               GRANT ... TO authenticated on anything this file did not create, GRANT ON ALL ... TO authenticated
  structure    CREATE TABLE without ENABLE ROW LEVEL SECURITY and an os_is_owner() policy in the same file,
               CREATE VIEW without security_invoker
  guards (QA r2 R2S06, R2D06)
               DISABLE TRIGGER, session_replication_role, CREATE OR REPLACE / ALTER of a guard function or trigger
               (PROTECTED), any mention of owner_uid (in code or in a string), a policy that uses OR, names a role
               other than authenticated, or has no TO clause, SECURITY DEFINER without REVOKE ... FROM public in
               the same file, GRANT EXECUTE to authenticated on a SECURITY DEFINER function of the same file
Text inside `execute '...'` and `execute format('...')` is linted like code (QA r1 D16); other quoted
strings are data and are ignored.

The lint reads text, and SQL has too many spellings to catch them all (QA r3 R3S01: comments inside keywords,
concatenated dynamic SQL, CREATE RULE, ENABLE REPLICA TRIGGER ...). So from 0009 on, every migration is also checked
by its RESULT: inside the same transaction, before it commits, catalog_problems() compares the database with the
pinned shape below (guard functions by body hash, the exact trigger set, owner-only policies, RLS on, no rules,
security constraints, role memberships, function EXECUTE, owner_uid unchanged). Any drift rolls the file back.
A migration that adds a function, trigger or policy on purpose updates these pins in the same reviewed commit.
"""
from __future__ import annotations

import argparse, hashlib, os, re, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
MIGRATIONS = HERE / "migrations"
ENV_FALLBACKS = [HERE.parent / ".env"]
PROJECT_REF = os.environ.get("WORKOS_PROJECT_REF", "yourprojectref")
LOCK_KEY = "os_migrate"

# Files applied before the 2026-10-28 guard widening. They predate rules they break (dynamic DROP POLICY,
# USING (true) later replaced by 0005), so a fresh bootstrap would otherwise need --allow-forbidden.
# Exempt only while byte-identical: an edited copy is linted like any new file.
GRANDFATHERED = {
    "0001_os_schema.sql": "13736f17d6d2ea7e3c22f825a05c84536fc735c3a94656ba845991018643fb51",
    "0002_realtime.sql": "c35b026546d91cb9a7ba31d8a597cd93373f8e3e72b5581eb3eda1e534d66e6d",
    "0003_lock_anon.sql": "fc5db12468471a6544e627c049e1949235efb4c6b8cf8757a5e5b053fbf0e015",
    "0004_v1_tables.sql": "2fb3ca690a47da44e548608d4ad398ddc9a429d6b496caec9f93a7a10a75d808",
    "0005_owner_lock.sql": "ce6dcc9d78ba72a994a8939dce29f491dc68a5a25995628e49e18a602b957e28",
    "0006_claude_requests.sql": "1717f4e7480cc3cbb422ee7fe40b301a6d4c7646f86789228e4c7c646e573be5",
    # 0007 creates the guards the 2026-10-29 rules protect, so it breaks those rules by design.
    "0007_qa_r1_hardening.sql": "9cb36835ddc42deb4baad28159a42402174e19f7f55f44ef21caa5d814c2d4af",
}

# The controls a later migration must never redefine, alter or switch off (QA r2 R2S06, R2D06).
PROTECTED_FUNCTIONS = ("os_is_owner", "os_guard_owner_uid", "os_claude_requests_stamp", "os_claude_requests_lock",
                       "os_guard_server_keys")
PROTECTED_TRIGGERS = ("os_settings_guard_owner_uid", "os_claude_requests_stamp", "os_claude_requests_lock",
                      "os_settings_guard_server_keys")

# ------------------------------------------------------------------ catalog pins (QA r3 R3S01)
CHECK_FROM = 9          # migrations numbered at or above this are checked by result as well as by text
OWNER_EXPR = "( SELECT os_is_owner() AS os_is_owner)"
# name -> (md5 of the body, SECURITY DEFINER, proconfig as text). Every public os_* function must be listed.
PINNED_FUNCTIONS = {
    "os_claude_requests_born": ("427d81fefa3933c4c2b87eda2b19d2ca", False, '{"search_path=\\"\\""}'),
    "os_claude_requests_lock": ("4f538f6185f33e8bab8e7b316cd34848", False, '{"search_path=\\"\\""}'),
    "os_claude_requests_stamp": ("42f6e75358cbae330f344ca004dc8f99", False, '{"search_path=\\"\\""}'),
    "os_guard_owner_uid": ("60db220153e792f459a0a80207d1a3d5", False, '{"search_path=\\"\\""}'),
    "os_guard_push_keys": ("2f289f6643dac01cae4e850a6af6e900", False, '{"search_path=\\"\\""}'),
    "os_guard_server_keys": ("4079e37ef1d2109ff90da2979d56cc83", False, '{"search_path=\\"\\""}'),
    "os_is_owner": ("e7e84b171d38a572ef50f7c73f69a6ee", True, "{search_path=public}"),
    "os_tasks_forget_deleted": ("02f0e6f53ae279f3cfd59ba612a389a3", False, '{"search_path=\\"\\""}'),
    "os_touch_updated_at": ("98689d408f8591b037abaabe28945dfe", False, '{"search_path=\\"\\""}'),
}
# (table, trigger, function), all enabled ('O'). The exact set on every os_* table: nothing more, nothing less.
PINNED_TRIGGERS = {
    ("os_claude_requests", "os_claude_requests_born", "os_claude_requests_born"),
    ("os_claude_requests", "os_claude_requests_lock", "os_claude_requests_lock"),
    ("os_claude_requests", "os_claude_requests_stamp", "os_claude_requests_stamp"),
    ("os_claude_requests", "os_claude_requests_touch", "os_touch_updated_at"),
    ("os_days", "os_days_touch", "os_touch_updated_at"),
    ("os_finance_entries", "os_finance_touch", "os_touch_updated_at"),
    ("os_notes", "os_notes_touch", "os_touch_updated_at"),
    ("os_reminders", "os_reminders_touch", "os_touch_updated_at"),
    ("os_settings", "os_settings_guard_owner_uid", "os_guard_owner_uid"),
    ("os_settings", "os_settings_guard_push_keys", "os_guard_push_keys"),
    ("os_settings", "os_settings_guard_server_keys", "os_guard_server_keys"),
    ("os_tasks", "os_tasks_forget_deleted", "os_tasks_forget_deleted"),
    ("os_tasks", "os_tasks_touch", "os_touch_updated_at"),
}
# Policies that are not the owner-all shape (cmd ALL, USING and WITH CHECK both OWNER_EXPR).
PINNED_READ_ONLY_POLICIES = {("os_claude_fires", "os_claude_fires_owner_read"),
                             ("os_calendar_events", "os_calendar_events_owner_read"),
                             ("os_calendar_links", "os_calendar_links_owner_read"),
                             ("os_calendar_state", "os_calendar_state_owner_read")}
PINNED_CONSTRAINTS = {
    "os_claude_requests_session_host": "CHECK (((session_url IS NULL) OR (session_url ~ '^https://claude\\.ai/code/'::text)))",
    "os_claude_requests_status_check": "CHECK ((status = ANY (ARRAY['queued'::text, 'firing'::text, 'sent'::text, 'done'::text, 'failed'::text, 'cancelled'::text])))",
    "os_claude_requests_handoff_check": "CHECK ((handoff = ANY (ARRAY['routine'::text, 'copy'::text])))",
    "os_claude_requests_brief_len": "CHECK ((length(brief) <= 20000))",
    "os_push_endpoint_host": "CHECK ((endpoint ~ '^https://(fcm\\.googleapis\\.com|[a-z0-9.-]+\\.push\\.services\\.mozilla\\.com|web\\.push\\.apple\\.com|[a-z0-9.-]+\\.notify\\.windows\\.com)/'::text))",
    "os_events_url_scheme": "CHECK (((url IS NULL) OR (url ~ '^(https://|/)'::text)))",
    "os_calendar_events_html_link_host": "CHECK (((html_link IS NULL) OR (html_link ~ '^https://www\\.google\\.com/calendar/'::text)))",
    "os_calendar_events_meet_link_host": "CHECK (((meet_link IS NULL) OR (meet_link ~ '^https://meet\\.google\\.com/[a-z]{3}-[a-z]{4}-[a-z]{3}(\\?[a-z0-9=&_-]*)?$'::text)))",
}
# Constraints that only exist from a later migration on, so a fresh bootstrap can pass the check after an earlier file.
PINNED_CONSTRAINTS_FROM = {"os_calendar_events_html_link_host": 10, "os_calendar_events_meet_link_host": 10}
# Read-only tables for authenticated (SELECT only) and tables it must not touch at all.
AUTH_SELECT_ONLY = {"os_claude_fires", "os_campaign_daily", "os_campaign_baseline24", "os_campaigns_latest",
                    "os_calendar_events", "os_calendar_state"}
AUTH_NONE = {"os_schema_migrations", "os_calendar_links"}


def owner_uid_value(cur):
    cur.execute("select value::text from public.os_settings where key = 'owner_uid'")
    r = cur.fetchone()
    return r[0] if r else None


def catalog_problems(cur, owner_before, file_no=None) -> list[str]:
    """What the database now looks like versus the pinned shape. Empty list = as expected. Read-only queries.
    file_no: the migration just run; None holds the database to every pin."""
    out = []
    q = lambda sql: (cur.execute(sql), cur.fetchall())[1]   # noqa: E731
    funcs = {r[0]: r[1:] for r in q("""select p.proname, md5(p.prosrc), p.prosecdef, coalesce(p.proconfig::text, '')
                                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                        where n.nspname = 'public' and p.proname like 'os\\_%'""")}
    for name in sorted(set(funcs) | set(PINNED_FUNCTIONS)):
        if name not in PINNED_FUNCTIONS:
            out.append(f"function {name} is not pinned in apply.py")
        elif name not in funcs:
            out.append(f"function {name} is missing")
        elif tuple(funcs[name]) != PINNED_FUNCTIONS[name]:
            out.append(f"function {name} was changed")
    for name, rettype in q("""select p.proname, p.prorettype::regtype::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                               where n.nspname = 'public' and p.proname <> 'os_is_owner'
                                 and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
                                 and (has_function_privilege('authenticated', p.oid, 'execute')
                                      or has_function_privilege('anon', p.oid, 'execute'))"""):
        if rettype not in ("trigger", "event_trigger"):     # trigger functions cannot be called directly
            out.append(f"function {name} can be called by app users")
    trig = {(t, n, f): e for t, n, f, e in q("""select c.relname, t.tgname, p.proname, t.tgenabled from pg_trigger t
                                                  join pg_class c on c.oid = t.tgrelid join pg_namespace s on s.oid = c.relnamespace
                                                  join pg_proc p on p.oid = t.tgfoid
                                                 where not t.tgisinternal and s.nspname = 'public' and c.relname like 'os\\_%'""")}
    for k in sorted(set(trig) ^ PINNED_TRIGGERS):
        out.append(f"trigger {k[1]} on {k[0]} is {'not pinned' if k in trig else 'missing'}")
    out += [f"trigger {k[1]} on {k[0]} is not enabled normally ({e})" for k, e in sorted(trig.items()) if e != "O"]
    out += [f"rule {r[1]} on {r[0]}" for r in q("select tablename, rulename from pg_rules where schemaname = 'public'")]
    out += [f"table {r[0]} has row level security off" for r in q("""select c.relname from pg_class c join pg_namespace n
              on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname like 'os\\_%'
              and not c.relrowsecurity""")]
    for t, pol, perm, roles, cmd, qual, chk in q("""select tablename, policyname, permissive, roles::text, cmd, qual, with_check
                                                     from pg_policies where schemaname = 'public'"""):
        ok_roles = perm == "PERMISSIVE" and roles == "{authenticated}"
        if (t, pol) in PINNED_READ_ONLY_POLICIES:
            ok = ok_roles and cmd == "SELECT" and qual == OWNER_EXPR and chk is None
        else:
            ok = ok_roles and cmd == "ALL" and qual == OWNER_EXPR and chk == OWNER_EXPR
        if not ok:
            out.append(f"policy {pol} on {t} is not owner-only")
    cons = dict(q(f"""select conname, pg_get_constraintdef(oid) from pg_constraint
                       where conname in ({', '.join("'" + c + "'" for c in PINNED_CONSTRAINTS)}) and convalidated"""))
    out += [f"constraint {c} was changed or is not validated" for c, d in PINNED_CONSTRAINTS.items()
            if cons.get(c) != d and (file_no is None or file_no >= PINNED_CONSTRAINTS_FROM.get(c, 0))]
    out += [f"role {r[0]} is a member of {r[1]}" for r in q("""select u.rolname, r.rolname from pg_auth_members m
              join pg_roles r on r.oid = m.roleid join pg_roles u on u.oid = m.member where u.rolname in ('anon', 'authenticated')""")]
    for t, kind in q("""select c.relname, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace
                         where n.nspname = 'public' and c.relkind in ('r', 'v', 'p', 'm') and c.relname like 'os\\_%'"""):
        cur.execute("""select has_table_privilege('anon', %(t)s, 'select,insert,update,delete,truncate,references,trigger'),
                              has_table_privilege('authenticated', %(t)s, 'insert,update,delete,truncate,references,trigger'),
                              has_table_privilege('authenticated', %(t)s, 'select')""", {"t": f"public.{t}"})
        anon, write, read = cur.fetchone()
        if anon:
            out.append(f"anon has a privilege on {t}")
        if t in AUTH_NONE and (read or write):
            out.append(f"authenticated can reach {t}")
        if t in AUTH_SELECT_ONLY and write:
            out.append(f"authenticated can write {t}")
    cur.execute("select has_table_privilege('authenticated', 'public.os_tasks', 'truncate')")
    if cur.fetchone()[0]:
        out.append("authenticated can truncate os_tasks")
    if owner_uid_value(cur) != owner_before:
        out.append("owner_uid was changed")
    return out


# Rules checked against the whole file (code + linted execute strings).
_RULES = [
    (re.compile(r"\bDROP\b", re.I), "DROP"),
    (re.compile(r"\bDELETE\s+FROM\b", re.I), "DELETE FROM"),
    (re.compile(r"\bRENAME\b", re.I), "RENAME"),
    (re.compile(r"\bALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE\b", re.I), "ALTER COLUMN ... TYPE"),
    (re.compile(r"\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b", re.I), "DISABLE ROW LEVEL SECURITY"),
    (re.compile(r"\bGRANT\b[^;]*\bTO\s+(anon|public)\b", re.I), "GRANT ... TO anon/public"),
    (re.compile(r"\bALTER\b[^;]*\bOWNER\s+TO\b", re.I), "ALTER ... OWNER TO"),
    (re.compile(r"\b(USING|WITH\s+CHECK)\s*\(\s*true\s*\)", re.I), "USING (true) / WITH CHECK (true)"),
    (re.compile(r"\bCREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+(\"?public\"?\.)?\"?os_is_owner\b", re.I), "redefines os_is_owner"),
    (re.compile(r"\bALTER\s+FUNCTION\s+(\"?public\"?\.)?\"?os_is_owner\b", re.I), "alters os_is_owner"),
    (re.compile(r"\bGRANT\b[^;]*\bON\s+ALL\b[^;]*\bTO\s+authenticated\b", re.I), "GRANT ON ALL ... TO authenticated"),
    (re.compile(r"\bDISABLE\s+(ALWAYS\s+)?TRIGGER\b", re.I), "DISABLE TRIGGER"),
    (re.compile(r"\bsession_replication_role\b", re.I), "session_replication_role"),
    (re.compile(r"\b(CREATE\s+OR\s+REPLACE|ALTER)\s+FUNCTION\s+(\"?public\"?\.)?\"?(" + "|".join(PROTECTED_FUNCTIONS) + r")\b", re.I),
     "redefines a guard function"),
    (re.compile(r"\b(CREATE\s+OR\s+REPLACE|ALTER)\s+TRIGGER\s+\"?(" + "|".join(PROTECTED_TRIGGERS) + r")\b", re.I),
     "redefines a guard trigger"),
]
_DEFINER_FN = re.compile(r"\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+" + r"(?:\"?public\"?\.)?\"?(\w+)\"?[^;]*\bSECURITY\s+DEFINER\b", re.I)
_POLICY_TO = re.compile(r"\bTO\s+(.+?)(?=\bUSING\b|\bWITH\s+CHECK\b|$)", re.I | re.S)
_UPDATE = re.compile(r"\bUPDATE\s+(ONLY\s+)?[\w.\"]+(\s+(AS\s+)?(?!SET\b)\w+)?\s+SET\b", re.I)
_WHERE = re.compile(r"\bWHERE\b", re.I)
_SWAP = re.compile(r"\bDROP\s+CONSTRAINT\s+(IF\s+EXISTS\s+)?\"?(\w+)\"?", re.I)
_NAME = r"(?:\"?public\"?\.)?\"?(\w+)\"?"
_CREATE_TABLE = re.compile(r"\bCREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?" + _NAME, re.I)
_CREATE_TEMP = re.compile(r"\bCREATE\s+(?:LOCAL\s+|GLOBAL\s+)?TEMP(?:ORARY)?\s+TABLE\b", re.I)
_CREATE_VIEW = re.compile(r"\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?" + _NAME, re.I)
_ENABLE_RLS = re.compile(r"\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?" + _NAME + r"\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY\b", re.I)
_POLICY = re.compile(r"\b(CREATE|ALTER)\s+POLICY\s+\"?\w+\"?\s+ON\s+" + _NAME, re.I)
_GRANT_AUTH = re.compile(r"\bGRANT\b(?P<body>[^;]*?)\bTO\s+authenticated\b", re.I)
_GRANT_ON = re.compile(r"\bON\s+(?:TABLE\s+|SEQUENCE\s+|FUNCTION\s+|SCHEMA\s+)?([^;]*?)\s*$", re.I)


def _strip_sql(sql: str) -> tuple[str, list[str]]:
    """Drop -- and /* */ comments and blank out '...' literals (dollar-quoted bodies are kept as code).
    Returns (code, dynamic): `dynamic` holds the text of every literal that follows EXECUTE or
    EXECUTE format(, so dynamic SQL is linted too."""
    out, dynamic, i, n = [], [], 0, len(sql)
    while i < n:
        c = sql[i]
        if c == "-" and sql.startswith("--", i):
            j = sql.find("\n", i)
            i = n if j == -1 else j
        elif c == "/" and sql.startswith("/*", i):
            j = sql.find("*/", i + 2)
            i = n if j == -1 else j + 2
        elif c == "'":
            # An E'...' literal uses backslash escapes; everything else only doubles the quote.
            esc = bool(out) and out[-1] in "eE" and (len(out) < 2 or not (out[-2].isalnum() or out[-2] == "_"))
            i += 1
            buf = []
            while i < n:
                if esc and sql[i] == "\\" and i + 1 < n:
                    buf.append(sql[i + 1])
                    i += 2
                elif sql.startswith("''", i):
                    buf.append("'")
                    i += 2
                elif sql[i] == "'":
                    i += 1
                    break
                else:
                    buf.append(sql[i])
                    i += 1
            if re.search(r"\bEXECUTE\s+(format\s*\(\s*)?$", "".join(out[-40:]), re.I):
                dynamic.append("".join(buf))
            out.append("''")
        else:
            out.append(c)
            i += 1
    return "".join(out), dynamic


def _without_comments(sql: str) -> str:
    """The SQL with comments removed but every string literal kept (for rules that must see data too)."""
    out, i, n = [], 0, len(sql)
    while i < n:
        if sql.startswith("--", i):
            j = sql.find("\n", i)
            i = n if j == -1 else j
        elif sql.startswith("/*", i):
            j = sql.find("*/", i + 2)
            i = n if j == -1 else j + 2
        elif sql[i] == "'":
            j = i + 1
            while j < n and not (sql[j] == "'" and not sql.startswith("''", j)):
                j += 2 if sql.startswith("''", j) else 1
            out.append(sql[i:j + 1])
            i = j + 1
        else:
            out.append(sql[i])
            i += 1
    return "".join(out)


def _statements(code: str) -> list[str]:
    """Split stripped SQL on top-level semicolons; $tag$ ... $tag$ bodies stay inside their statement."""
    out, cur, i, n = [], [], 0, len(code)
    tag = re.compile(r"\$[A-Za-z_]\w*\$|\$\$")
    while i < n:
        if code[i] == "$":
            m = tag.match(code, i)
            if m:
                end = code.find(m.group(0), m.end())
                end = n if end == -1 else end + len(m.group(0))
                cur.append(code[i:end])
                i = end
                continue
        if code[i] == ";":
            out.append("".join(cur))
            cur = []
        else:
            cur.append(code[i])
        i += 1
    if "".join(cur).strip():
        out.append("".join(cur))
    return [s for s in out if s.strip()]


def _remove_constraint_swaps(stmt: str) -> str:
    """`ALTER TABLE t DROP CONSTRAINT c, ADD CONSTRAINT c ...` replaces c atomically: not destructive."""
    if not re.match(r"\s*ALTER\s+TABLE\b", stmt, re.I):
        return stmt
    for m in list(_SWAP.finditer(stmt)):
        if re.search(r"\bADD\s+CONSTRAINT\s+\"?" + re.escape(m.group(2)) + r"\b", stmt, re.I):
            stmt = stmt.replace(m.group(0), " ")
    return stmt


def _bare(name: str) -> str:
    return name.strip().strip('"').split(".")[-1].strip('"').lower()


def forbidden_reasons(sql: str) -> list[str]:
    """Refused constructs found in a migration; empty list means safe."""
    code, dynamic = _strip_sql(sql)
    stmts = [_remove_constraint_swaps(s) for s in _statements(code)]
    for d in dynamic:   # dynamic SQL: its own literals are data again
        stmts += [_remove_constraint_swaps(s) for s in _statements(_strip_sql(d)[0])]
    text = ";\n".join(stmts)
    found = [label for rx, label in _RULES if rx.search(text)]
    if re.search(r"\bowner_uid\b", _without_comments(sql), re.I):
        found.append("mentions owner_uid")

    for s in stmts:
        # TRUNCATE is refused anywhere except in a REVOKE (taking the privilege away is the safe direction).
        if re.search(r"\bTRUNCATE\b", s, re.I) and not re.match(r"\s*(REVOKE|ALTER\s+DEFAULT\s+PRIVILEGES\b[^;]*\bREVOKE)\b", s, re.I):
            found.append("TRUNCATE")
        flat = re.sub(r"\bDO\s+UPDATE\b", "DO_UPDATE", s, flags=re.I)   # ON CONFLICT ... DO UPDATE SET is fine
        for m in _UPDATE.finditer(flat):
            if not _WHERE.search(flat, m.end()):
                found.append("UPDATE without WHERE")
                break
        if re.search(r"\bSECURITY\s+DEFINER\b", s, re.I) and not re.search(r"\bSET\s+search_path\b", s, re.I):
            found.append("SECURITY DEFINER without SET search_path")
        pm = _POLICY.search(s)
        if pm and not re.search(r"\bos_is_owner\s*\(", s, re.I):
            found.append(f"policy on {pm.group(2)} without os_is_owner()")
        if pm:
            if re.search(r"\bOR\b", s, re.I):
                found.append(f"policy on {pm.group(2)} uses OR")
            to = _POLICY_TO.search(s[pm.end():])
            roles = [_bare(r) for r in to.group(1).split(",")] if to else []
            if pm.group(1).upper() == "CREATE" and not roles:
                found.append(f"policy on {pm.group(2)} without TO (defaults to public)")
            if any(r != "authenticated" for r in roles):
                found.append(f"policy on {pm.group(2)} for a role other than authenticated")
        vm = _CREATE_VIEW.search(s)
        if vm and not re.search(r"\bsecurity_invoker\b", s, re.I):
            found.append(f"view {vm.group(1)} without security_invoker")

    created_tables = {m.group(1).lower() for s in stmts if not _CREATE_TEMP.search(s) for m in _CREATE_TABLE.finditer(s)}
    created = created_tables | {m.group(1).lower() for s in stmts for m in _CREATE_VIEW.finditer(s)}
    rls = {m.group(1).lower() for s in stmts for m in _ENABLE_RLS.finditer(s)}
    owner_policy = {m.group(2).lower() for s in stmts for m in _POLICY.finditer(s) if re.search(r"\bos_is_owner\s*\(", s, re.I)}
    for t in sorted(created_tables):
        if t not in rls:
            found.append(f"table {t} without ENABLE ROW LEVEL SECURITY")
        if t not in owner_policy:
            found.append(f"table {t} without an os_is_owner() policy")
    definers = {m.group(1).lower() for s in stmts for m in _DEFINER_FN.finditer(s)}
    for fn in sorted(definers):
        if not any(re.match(r"\s*REVOKE\b[^;]*\bON\s+FUNCTION\s+(\"?public\"?\.)?\"?" + fn + r"\b[^;]*\bFROM\b[^;]*\bpublic\b", s, re.I)
                   for s in stmts):
            found.append(f"SECURITY DEFINER {fn} without REVOKE ... FROM public")
        if any(re.match(r"\s*GRANT\b[^;]*\bON\s+FUNCTION\s+(\"?public\"?\.)?\"?" + fn + r"\b[^;]*\bTO\b[^;]*\bauthenticated\b", s, re.I)
               for s in stmts):
            found.append(f"GRANT EXECUTE to authenticated on SECURITY DEFINER {fn}")
    for s in stmts:
        for g in _GRANT_AUTH.finditer(s):
            on = _GRANT_ON.search(g.group("body"))
            if not on or re.match(r"\s*ALL\b", on.group(1), re.I):
                continue   # GRANT ON ALL is its own rule; a role grant without ON is not an object grant
            targets = [_bare(x) for x in on.group(1).split(",")]
            if any(re.sub(r"\(.*", "", t) not in created for t in targets):
                found.append("GRANT ... TO authenticated on an object this file did not create")
                break
    return list(dict.fromkeys(found))


def _dotenv(path: Path) -> dict:
    out = {}
    if path.is_file():
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            if line.startswith("export "):
                line = line[7:].lstrip()
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip("'\"")
    return out


def db_url() -> str:
    if os.environ.get("SUPABASE_DB_URL"):
        return os.environ["SUPABASE_DB_URL"]
    for p in ENV_FALLBACKS:
        v = _dotenv(p).get("SUPABASE_DB_URL")
        if v:
            return v
    sys.exit("No SUPABASE_DB_URL in the environment or WF - WorkOS/.env. Nothing was touched.")


def redact(u: str) -> str:
    return re.sub(r"://([^:/]+):([^@]+)@", r"://\1:***@", u)


def is_workos(url: str) -> bool:
    """True when the URL (password removed) names the WorkOS project ref, in the host or the
    pooler user name (postgres.<ref>)."""
    return bool(PROJECT_REF) and PROJECT_REF in redact(url)


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def lint_file(p: Path) -> list[str]:
    """Guard findings for one pending file; a grandfathered file is exempt only while byte-identical."""
    if GRANDFATHERED.get(p.name) == sha(p):
        return []
    return forbidden_reasons(p.read_text())


def numbered_too_low(pending: list[str], applied) -> list[str]:
    """Pending files numbered at or below the highest applied one. The result check starts at a file number, so a late
    file with an old number would run under older rules (QA r4 R4B13)."""
    top = max((int(n[:4]) for n in applied if n[:4].isdigit()), default=0)
    return [n for n in pending if int(n[:4]) <= top]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--allow-forbidden", action="store_true")
    args = ap.parse_args()
    do_apply = args.apply and not args.dry_run

    files = sorted(p for p in MIGRATIONS.glob("*.sql") if re.match(r"^\d{4}_", p.name))
    if not files:
        sys.exit(f"No migrations in {MIGRATIONS}")
    try:
        import psycopg
    except ImportError:
        sys.exit('pip install "psycopg[binary]"')

    url = db_url()
    if do_apply and not is_workos(url):
        sys.exit(f"Refusing --apply: the URL does not name project {PROJECT_REF} (set WORKOS_PROJECT_REF to override). Nothing was touched.")
    print(f"target : {redact(url)}\nmode   : {'APPLY' if do_apply else 'dry run'}")
    with psycopg.connect(url, autocommit=False) as conn:
        conn.add_notice_handler(lambda d: print(f"  notice : {d.message_primary}"))
        with conn.cursor() as cur:
            if do_apply:
                # Session-level lock: a local apply and the CI apply can never interleave (QA r1 D16).
                cur.execute("SELECT pg_try_advisory_lock(hashtext(%s))", (LOCK_KEY,))
                if not cur.fetchone()[0]:
                    sys.exit("Another apply holds the migration lock. Nothing was touched; try again when it finishes.")
                cur.execute("""CREATE TABLE IF NOT EXISTS public.os_schema_migrations (
                    filename text PRIMARY KEY, sha256 char(64) NOT NULL,
                    applied_at timestamptz NOT NULL DEFAULT now())""")
                conn.commit()
            cur.execute("SELECT to_regclass('public.os_schema_migrations')")
            exists = cur.fetchone()[0] is not None
            applied = {}
            if exists:
                cur.execute("SELECT filename, sha256 FROM public.os_schema_migrations")
                applied = dict(cur.fetchall())
            conn.commit()
        pending = []
        for f in files:
            if f.name in applied:
                if applied[f.name].strip() != sha(f):
                    sys.exit(f"{f.name} was applied with a different sha256. Immutable: add a new file.")
                print(f"  applied  {f.name}")
            else:
                print(f"  PENDING  {f.name}")
                pending.append(f)
        if not pending:
            print("nothing to do")
            return 0
        low = numbered_too_low([f.name for f in pending], applied)
        if low:
            sys.exit(f"{', '.join(low)} numbered at or below an applied file. Refusing. Give it the next free number.")
        # The guard is a lint on what is about to run, never on history (an applied file is immutable anyway).
        for f in pending:
            found = lint_file(f)
            if found and not args.allow_forbidden:
                sys.exit(f"{f.name} contains {', '.join(found)}. Refusing.")
        if not do_apply:
            print(f"{len(pending)} pending. Re-run with --apply.")
            return 0
        for f in pending:
            print(f"applying {f.name} ...", end=" ", flush=True)
            try:
                with conn.cursor() as cur:
                    owner_before = owner_uid_value(cur) if int(f.name[:4]) >= CHECK_FROM else None
                    cur.execute(f.read_text())
                    if int(f.name[:4]) >= CHECK_FROM:
                        drift = catalog_problems(cur, owner_before, int(f.name[:4]))
                        if drift:
                            conn.rollback()
                            print("REFUSED (rolled back): the database would no longer match the pinned shape")
                            for d in drift:
                                print(f"  - {d}")
                            return 1
                    cur.execute("INSERT INTO public.os_schema_migrations(filename, sha256) VALUES (%s,%s)",
                                (f.name, sha(f)))
                conn.commit()
                print("ok")
            except Exception as e:  # noqa: BLE001
                conn.rollback()
                print(f"FAILED (rolled back)\n  {type(e).__name__}: {e}")
                return 1
    print("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
