#!/usr/bin/env python3
"""
Live query-contract test for WorkOS (no anon key needed; Postgres connection only).
Env: SUPABASE_DB_URL. Run: /tmp/wos-venv/bin/python db/tests/test_contract.py
Checks (1) every table/view/column/type the app's types.ts + live data layer touch, (2) onConflict targets,
(3) realtime channels, (4) every read query from app/src/lib/store.ts as role authenticated,
(5) every write path from app/src/lib/actions.ts as authenticated inside a transaction that is rolled back.
Exit code 1 on any failure. Prints PASS/FAIL lines only, never secrets.
"""
import json, os, re, sys, uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
import psycopg

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "app/src/lib"
fails, passes = [], 0


def ok(name):
    global passes
    passes += 1
    print("PASS", name)


def bad(name, why, where=""):
    fails.append((name, why, where))
    print("FAIL", name, "-", why, where)


# ---------------------------------------------------------------- 1. column/type contract from types.ts
TYPE_TABLE = {"Task": "os_tasks", "Reminder": "os_reminders", "Day": "os_days", "Habit": "os_habits",
              "HabitLog": "os_habit_logs", "OsEvent": "os_events", "Campaign": "os_campaigns_latest",
              "SmsDay": "os_sms_days", "Note": "os_notes", "FinanceEntry": "os_finance_entries",
              "PushSub": "os_push_subscriptions", "SettingRow": "os_settings"}
COMPAT = {  # TS type -> acceptable pg udt_name
    "string": {"text", "uuid", "date", "time", "timestamptz", "varchar", "bpchar"},
    "number": {"int2", "int4", "int8", "numeric", "float8"},
    "boolean": {"bool"},
    "string[]": {"_uuid", "_text"},
    "number[]": {"_int2", "_int4"},
    "unknown": {"jsonb", "json"},
    "Record<string, unknown>": {"jsonb"},
}


def parse_types():
    txt = (SRC / "types.ts").read_text().splitlines()
    out, cur = {}, None
    for i, line in enumerate(txt, 1):
        m = re.match(r"export type (\w+) = \{\s*$", line)
        if m:
            cur = m.group(1); out[cur] = []; continue
        if cur and line.startswith("};"):
            cur = None; continue
        if cur:
            m = re.match(r"\s+(\w+)(\?)?: (.+?);", line)
            if m: out[cur].append((m.group(1), m.group(3), i))
            continue
        m = re.match(r"export type (\w+) = \{ (.+) \};", line)   # one-line types (HabitLog, PushSub, SettingRow)
        if m:
            out[m.group(1)] = [(p.split(":")[0].strip().rstrip("?"), p.split(":", 1)[1].strip(), i) for p in m.group(2).split(";") if ":" in p]
    return out


def ts_kind(t):
    t = t.replace(" | null", "").strip()
    if re.fullmatch(r"('[^']+'\s*\|?\s*)+", t) or t in ("Area", "Repeat", "Severity"):
        return "string"
    if t.startswith("Record<"): return "Record<string, unknown>"
    return t


def check_columns(cur):
    cur.execute("select table_name,column_name,udt_name from information_schema.columns where table_schema='public' and table_name like 'os_%'")
    cols = {(t, c): u for t, c, u in cur.fetchall()}
    cur.execute("select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v')")
    rels = {r[0] for r in cur.fetchall()}
    for ty, fields in parse_types().items():
        tbl = TYPE_TABLE.get(ty)
        if not tbl: continue
        where = f"app/src/lib/types.ts"
        if tbl not in rels: bad(f"relation {tbl}", "missing", where); continue
        for name, t, line in fields:
            u = cols.get((tbl, name))
            if u is None: bad(f"{tbl}.{name}", "column missing in DB", f"{where}:{line}"); continue
            k = ts_kind(t)
            if k in COMPAT and u not in COMPAT[k]: bad(f"{tbl}.{name}", f"TS {t} vs pg {u}", f"{where}:{line}")
            elif k not in COMPAT: bad(f"{tbl}.{name}", f"unmapped TS type {t}", f"{where}:{line}")
        ok(f"columns {ty} -> {tbl} ({len(fields)} fields)")
    # Snapshot slice select list (store.ts:52)
    snap = "id,taken_at,channel,account,campaign_id,sent_total,replies_total,positives_total,bounces_total".split(",")
    miss = [c for c in snap if ("os_campaign_snapshots", c) not in cols]
    bad("snapshots select list", f"missing {miss}", "store.ts:52") if miss else ok("snapshots select list columns")
    # every order/filter column
    for tbl, c, line in [("os_tasks", "sort_order", 43), ("os_reminders", "created_at", 44), ("os_days", "day", 45), ("os_habits", "sort_order", 46),
                         ("os_habit_logs", "day", 47), ("os_events", "occurred_at", 48), ("os_events", "read_at", 49),
                         ("os_campaign_snapshots", "taken_at", 53), ("os_campaigns_latest", "campaign_name", 56), ("os_sms_days", "day", 57),
                         ("os_notes", "updated_at", 58), ("os_finance_entries", "month", 59), ("os_push_subscriptions", "created_at", 61)]:
        (ok if (tbl, c) in cols else lambda n: bad(n, "column missing", f"store.ts:{line}"))(f"order/filter {tbl}.{c}")
    # pushed_at / last_pushed_on are used by the server, declared optional in types
    return cols


# ---------------------------------------------------------------- 2. onConflict targets
def check_conflicts(cur):
    cur.execute("""select c.relname, array_agg(a.attname order by k.ord)
                   from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace
                   cross join lateral unnest(i.indkey) with ordinality k(attnum, ord)
                   join pg_attribute a on a.attrelid=c.oid and a.attnum=k.attnum
                   where n.nspname='public' and i.indisunique and i.indpred is null group by c.relname, i.indexrelid""")
    uniq = {}
    for t, cols in cur.fetchall(): uniq.setdefault(t, []).append(cols)
    for tbl, col, where in [("os_days", "day", "actions.ts:126 upsertRow days"), ("os_settings", "key", "actions.ts:198 setSetting"),
                            ("os_push_subscriptions", "endpoint", "push.ts:43 upsertRow push_subs")]:
        (ok if [col] in uniq.get(tbl, []) else lambda n: bad(n, "no unique index/constraint", where))(f"onConflict {tbl}({col})")


# ---------------------------------------------------------------- 3. realtime (Shell.tsx:67,71 + supabase.ts:118)
def check_realtime(cur):
    cur.execute("select tablename from pg_publication_tables where pubname='supabase_realtime' and schemaname='public'")
    pub = {r[0] for r in cur.fetchall()}
    cur.execute("select pubinsert from pg_publication where pubname='supabase_realtime'")
    ins = cur.fetchone()[0]
    for t, w in [("os_events", "Shell.tsx:67"), ("os_campaign_snapshots", "Shell.tsx:71")]:
        (ok if t in pub else lambda n: bad(n, "not in supabase_realtime", w))(f"realtime publication {t}")
        cur.execute("select relreplident from pg_class where oid=%s::regclass", (f"public.{t}",))
        ri = cur.fetchone()[0]
        (ok if ri in ("d", "f") else lambda n: bad(n, f"replica identity {ri}", w))(f"replica identity {t} = {ri} (INSERT-only subscription needs none)")
        cur.execute("select 1 from pg_policies where schemaname='public' and tablename=%s and 'authenticated'=any(roles) and cmd in ('ALL','SELECT')", (t,))
        (ok if cur.fetchone() else lambda n: bad(n, "no authenticated SELECT policy", w))(f"realtime RLS select policy {t}")
        cur.execute("select has_table_privilege('authenticated', %s, 'select')", (f"public.{t}",))
        (ok if cur.fetchone()[0] else lambda n: bad(n, "authenticated lacks SELECT", w))(f"realtime grant {t}")
    (ok if ins else lambda n: bad(n, "publication does not publish inserts", "supabase.ts:121"))("publication publishes INSERT")


# ---------------------------------------------------------------- 4/5. execute as authenticated
def as_auth(cur, uid):
    cur.execute("set local role authenticated")
    cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({"role": "authenticated", "sub": uid}),))


def run(cur, name, sql, args=(), where="", expect=None):
    cur.execute("savepoint s")
    try:
        cur.execute(sql, args)
        n = cur.rowcount if cur.description is None else len(cur.fetchall())
        cur.execute("release savepoint s")
        if expect is not None and n != expect: bad(name, f"expected {expect} rows, got {n}", where)
        else: ok(f"{name} -> {n} rows")
        return n
    except Exception as e:
        cur.execute("rollback to savepoint s")
        bad(name, str(e).splitlines()[0], where)
        return None


def reads(cur):
    d = lambda n: (datetime.now(timezone(timedelta(hours=5, minutes=30))).date() - timedelta(days=n)).isoformat()
    S = "store.ts"
    Q = [("tasks", "select * from os_tasks order by sort_order asc", (), 43),
         ("reminders", "select * from os_reminders order by created_at asc", (), 44),
         ("days", "select * from os_days where day >= %s", (d(60),), 45),
         ("habits", "select * from os_habits order by sort_order asc", (), 46),
         ("habit_logs", "select * from os_habit_logs where day >= %s", (d(400),), 47),
         ("events", "select * from os_events order by occurred_at desc limit 50", (), 48),
         ("unread", "select * from os_events where read_at is null order by occurred_at desc limit 300", (), 49),
         # QA r1 contract (D1, D23): daily view instead of raw snapshots; campaigns without raw
         ("snapshots", "select id,taken_at,ist_day,channel,account,campaign_id,sent_total,replies_total,positives_total,bounces_total from os_campaign_daily order by taken_at asc limit 5000", (), 52),
         ("campaigns", "select id,taken_at,channel,account,campaign_id,campaign_name,status,sent_total,replies_total,positives_total,bounces_total,opens_total,leads_total,raw->>'playbook_status' as playbook_status,raw->>'location_id' as location_id from os_campaigns_latest order by campaign_name asc", (), 56),
         ("claude", "select id,area,task_id,title,status,session_url,result,error,attempts,seen_at,created_by,sent_at,finished_at,created_at,updated_at from os_claude_requests order by created_at desc limit 200", (), 0),
         ("sms_days", "select * from os_sms_days where day >= %s", (d(30),), 57),
         ("notes", "select * from os_notes order by updated_at desc", (), 58),
         ("finance", "select * from os_finance_entries order by month asc", (), 59),
         ("settings", "select * from os_settings", (), 60),
         ("push_subs", "select * from os_push_subscriptions order by created_at asc", (), 61)]
    for n, sql, a, ln in Q: run(cur, f"READ {n}", sql, a, f"{S}:{ln}")


def writes(cur):
    A = "actions.ts"
    now = datetime.now(timezone.utc)
    tid, rid, hid, nid, fid, eid = (str(uuid.uuid4()) for _ in range(6))
    ep = "https://example.invalid/contract-test"
    run(cur, "INSERT task", """insert into os_tasks(id,title,notes,area,status,due_date,due_time,planned_for,priority,est_minutes,project,source,source_ref,waiting_on,next_action,cost_usd,sort_order,completed_at,created_at,updated_at)
        values(%s,'contract test',null,'work','open','2026-10-30','09:00',null,2,15,null,'user',null,null,null,null,0,null,%s,%s) returning *""", (tid, now, now), f"{A}:100-106")
    run(cur, "PATCH task done", "update os_tasks set status='done', completed_at=%s, notes='Followed up' where id=%s returning *", (now, tid), f"{A}:109,116", 1)
    run(cur, "PATCH task reopen", "update os_tasks set status='open', completed_at=null where id=%s returning *", (tid,), f"{A}:111", 1)
    run(cur, "PATCH task plan + clear pushed_at", "update os_tasks set planned_for='2026-10-30', pushed_at=null where id=%s returning *", (tid,), f"{A}:112; TaskSheet.tsx:58", 1)
    run(cur, "INSERT reminder", """insert into os_reminders(id,title,notes,area,remind_at,time_local,repeat,repeat_days,active,last_fired_at,task_id,created_at,updated_at)
        values(%s,'contract test',null,'personal',null,'08:00','daily','{}',true,null,null,%s,%s) returning *""", (rid, now, now), f"{A}:162-166")
    run(cur, "PATCH reminder fired", "update os_reminders set last_fired_at=%s, active=false where id=%s returning *", (now, rid), "reminders.ts:59", 1)
    run(cur, "INSERT habit", "insert into os_habits(id,name,area,days,time_local,active,sort_order,created_at) values(%s,'contract','personal','{0,1,2}',null,true,99,%s) returning *", (hid, now), f"{A}:140")
    run(cur, "PATCH habit sort_order", "update os_habits set sort_order=100 where id=%s returning *", (hid,), f"{A}:154", 1)
    run(cur, "INSERT habit_log", "insert into os_habit_logs(habit_id,day,done,note,created_at) values(%s,'2026-10-22',true,null,%s) returning *", (hid, now), f"{A}:132")
    run(cur, "DELETE habit_log", "delete from os_habit_logs where habit_id=%s and day='2026-10-22'", (hid,), f"{A}:135", 1)
    run(cur, "UPSERT day (onConflict day)", """insert into os_days(day,plan,review,top_task_ids,mood) values('2099-01-01','p',null,%s::uuid[],3)
        on conflict (day) do update set plan=excluded.plan, updated_at=now() returning *""", ([tid],), f"{A}:126")
    run(cur, "UPSERT setting (onConflict key)", """insert into os_settings(key,value,updated_at) values('contract_test','{"a":1}'::jsonb,now())
        on conflict (key) do update set value=excluded.value returning *""", (), f"{A}:198")
    run(cur, "INSERT note", "insert into os_notes(id,title,body,area,pinned,created_at,updated_at) values(%s,'t','b','work',false,%s,%s) returning *", (nid, now, now), f"{A}:179")
    run(cur, "PATCH note pin", "update os_notes set pinned=true where id=%s returning *", (nid,), f"{A}:182", 1)
    run(cur, "INSERT finance", """insert into os_finance_entries(id,kind,label,amount,currency,recurrence,month,end_month,source,source_ref,notes,created_at,updated_at)
        values(%s,'cost','t',12.5,'USD','one_time','2026-10-01',null,'manual',null,null,%s,%s) returning *""", (fid, now, now), f"{A}:189")
    run(cur, "INSERT event + PATCH markRead (id = any)", """insert into os_events(id,kind,title,severity,area,occurred_at) values(%s,'t','contract','info','work',%s) returning *""", (eid, now), "collectors")
    run(cur, "PATCH events read_at via in()", "update os_events set read_at=%s where id = any(%s::uuid[]) returning *", (now, [eid]), f"{A}:173", 1)
    run(cur, "UPSERT push sub (onConflict endpoint)", """insert into os_push_subscriptions(endpoint,p256dh,auth,device_label,created_at) values(%s,'k','a','test',now())
        on conflict (endpoint) do update set p256dh=excluded.p256dh returning *""", (ep,), "push.ts:43")
    run(cur, "DELETE push sub", "delete from os_push_subscriptions where endpoint=%s", (ep,), "push.ts:52", 1)
    # Ask Claude (0007 contract): created_by stamped by the trigger, one open request per task, Seen, Cancel
    cid = str(uuid.uuid4())
    run(cur, "INSERT claude request", """insert into os_claude_requests(id,area,task_id,title,brief,status)
        values(%s,'work',%s,'contract test','brief','queued') returning created_by""", (cid, tid), "actions.ts askClaude")
    cur.execute("savepoint s")
    try:
        cur.execute("insert into os_claude_requests(area,task_id,title,brief) values('work',%s,'dup','brief')", (tid,))
        cur.execute("release savepoint s"); bad("claude one open request per task", "second open request was accepted", "0007")
    except psycopg.errors.UniqueViolation:
        cur.execute("rollback to savepoint s"); ok("claude second open request -> 23505 (app treats as success)")
    run(cur, "PATCH claude seen", "update os_claude_requests set seen_at=%s where id=%s returning *", (now, cid), "Today Seen", 1)
    run(cur, "PATCH claude cancel", "update os_claude_requests set status='cancelled' where id=%s returning *", (cid,), "ClaudeSheet cancel", 1)
    for t, idv in [("os_tasks", tid), ("os_reminders", rid), ("os_notes", nid), ("os_finance_entries", fid)]:
        run(cur, f"DELETE {t}", f"delete from {t} where id=%s", (idv,), f"{A}:113,168,183,194", 1)
    # anon must be locked out (0003)
    cur.execute("reset role"); cur.execute("set local role anon")
    cur.execute("savepoint s")
    try:
        cur.execute("select 1 from os_tasks"); cur.execute("release savepoint s")
        bad("anon lockout", "anon CAN read os_tasks", "0003_lock_anon.sql")
    except Exception:
        cur.execute("rollback to savepoint s"); ok("anon is locked out of os_tasks")


def main():
    url = os.environ.get("SUPABASE_DB_URL") or sys.exit("SUPABASE_DB_URL not set")
    with psycopg.connect(url) as conn:
        cur = conn.cursor()
        check_columns(cur); check_conflicts(cur); check_realtime(cur)
        cur.execute("select id from auth.users where email='alex@example.com'")
        uid = str(cur.fetchone()[0])
        cur.execute("begin") if False else None
        as_auth(cur, uid); reads(cur); writes(cur)
        conn.rollback()      # nothing persists
    print(f"\n{passes} passed, {len(fails)} failed")
    for f in fails: print("  FAIL:", *f)
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
