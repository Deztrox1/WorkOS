"""Apply db/migrations 0001..N in order to a THROWAWAY Postgres the way apply.py --apply does (lint each
pending file, one transaction per file, ledger row), then probe the 0007, 0008 and 0010 data contracts and rules.

    python db/tests/throwaway_apply.py postgresql://postgres:x@127.0.0.1:55432/postgres          # clean DB
    python db/tests/throwaway_apply.py <url> --dirty   # seeds rule-breaking rows before 0007 is applied

Needs an EMPTY localhost Postgres 15+ (docker run --rm -d -p 55432:5432 -e POSTGRES_PASSWORD=x postgres:15).
Refuses any non-local URL. Applies db/tests/supabase_shim.sql first. Exit 1 on any failed check.
"""
import sys, json, uuid
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "db"))
import apply, psycopg

url = sys.argv[1]
DIRTY = "--dirty" in sys.argv
assert "127.0.0.1" in url or "localhost" in url, "throwaway only"
OWNER = "f8a39d57-03c5-4f4b-abf3-b822063b5b0c"
STRANGER = str(uuid.uuid4())
res = []
def check(name, cond, extra=""):
    res.append((name, bool(cond))); print(("PASS " if cond else "FAIL ") + name + (f"  {extra}" if extra else ""))

with psycopg.connect(url, autocommit=False, cursor_factory=psycopg.ClientCursor) as conn:
    conn.add_notice_handler(lambda d: print(f"  notice : {d.message_primary}"))
    cur = conn.cursor()
    cur.execute((Path(__file__).parent / "supabase_shim.sql").read_text()); conn.commit()
    cur.execute("SELECT pg_try_advisory_lock(hashtext(%s))", (apply.LOCK_KEY,)); check("advisory lock taken", cur.fetchone()[0])
    cur.execute("""CREATE TABLE IF NOT EXISTS public.os_schema_migrations (filename text PRIMARY KEY, sha256 char(64) NOT NULL,
                   applied_at timestamptz NOT NULL DEFAULT now())"""); conn.commit()
    files = sorted(p for p in apply.MIGRATIONS.glob("*.sql") if p.name[:4].isdigit())
    for f in files:
        if DIRTY and f.name.startswith("0007"):
            # rows 0007 must cope with: 2 open requests on one task, a done task without completed_at,
            # a finance row in a currency the app does not know
            cur.execute("insert into os_tasks(id,title,status) values ('00000000-0000-0000-0000-0000000000d1','dup','open'),('00000000-0000-0000-0000-0000000000d2','old done','done')")
            cur.execute("""insert into os_claude_requests(id,area,task_id,title,brief,status,sent_at,created_at) values
              ('00000000-0000-0000-0000-00000000c001','work','00000000-0000-0000-0000-0000000000d1','a','x','queued',null, now()-interval '2 min'),
              ('00000000-0000-0000-0000-00000000c002','work','00000000-0000-0000-0000-0000000000d1','b','x','sent',now(), now()-interval '1 min'),
              ('00000000-0000-0000-0000-00000000c003','work','00000000-0000-0000-0000-0000000000d1','c','x','queued',null, now())""")
            cur.execute("insert into os_finance_entries(kind,label,amount,currency,month) values ('cost','eur thing',1,'EUR','2026-10-01')")
            conn.commit()
        found = apply.lint_file(f)
        check(f"lint {f.name}", not found, ", ".join(found))
        try:
            owner_before = apply.owner_uid_value(cur) if int(f.name[:4]) >= apply.CHECK_FROM else None
            cur.execute(f.read_text())
            if int(f.name[:4]) >= apply.CHECK_FROM:
                drift = apply.catalog_problems(cur, owner_before, int(f.name[:4]))
                check(f"catalog after {f.name} matches the pins", not drift, "; ".join(drift))
            cur.execute("INSERT INTO public.os_schema_migrations(filename, sha256) VALUES (%s,%s)", (f.name, apply.sha(f)))
            conn.commit(); check(f"apply {f.name}", True)
        except Exception as e:
            conn.rollback(); check(f"apply {f.name}", False, f"{type(e).__name__}: {e}"); sys.exit(1)

    conn.autocommit = True
    def err(sql, args=()):
        try:
            cur.execute(sql, args); return None
        except Exception as e:
            code = getattr(e, "sqlstate", None) or type(e).__name__
            for _ in range(3):   # pglite-socket answers one round trip late after an error: drain it
                try:
                    cur.execute("select 1"); 
                    if cur.fetchone() == (1,): break
                except Exception:
                    pass
            return code

    if DIRTY:
        cur.execute("select id::text, status from os_claude_requests where task_id='00000000-0000-0000-0000-0000000000d1' order by id")
        st = dict(cur.fetchall())
        check("dirty: duplicates cancelled, the sent one kept", st == {"00000000-0000-0000-0000-00000000c001": "cancelled",
              "00000000-0000-0000-0000-00000000c002": "sent", "00000000-0000-0000-0000-00000000c003": "cancelled"}, str(st))
        cur.execute("select completed_at is not null from os_tasks where id='00000000-0000-0000-0000-0000000000d2'")
        check("dirty: old done task got completed_at", cur.fetchone()[0])
        cur.execute("select conname from pg_constraint where not convalidated and conrelid::regclass::text like '%os_%'")
        check("dirty: only the broken check is left NOT VALID", [r[0] for r in cur.fetchall()] == ["os_finance_currency"])
        cur.execute("insert into os_finance_entries(kind,label,amount,currency,month) values ('cost','ok',1,'USD','2026-10-01')")
        check("dirty: NOT VALID check still guards new rows", err("insert into os_finance_entries(kind,label,amount,currency,month) values ('cost','x',1,'EUR','2026-10-01')") == "23514")
        print(f"\n{sum(ok for _, ok in res)}/{len(res)} checks passed")
        sys.exit(0 if all(ok for _, ok in res) else 1)
    def as_user(uid):
        """The app's path: PostgREST logs in as authenticator, then SET ROLE authenticated plus the JWT claims."""
        cur.execute("reset role"); cur.execute("set session authorization authenticator"); cur.execute("set role authenticated")
        cur.execute("select set_config('request.jwt.claims', %s, false)", (json.dumps({"sub": uid, "role": "authenticated"}),))
    def as_forged(uid):
        """R2S01 a: a DB-URL holder copies the app's role and claims but stays session_user postgres."""
        as_postgres(); cur.execute("set role authenticated")
        cur.execute("select set_config('request.jwt.claims', %s, false)", (json.dumps({"sub": uid, "role": "authenticated"}),))
    def as_postgres():
        cur.execute("reset role"); cur.execute("set session authorization postgres"); cur.execute("select set_config('request.jwt.claims', '', false)")
    # ---- contract: columns, status, index
    cur.execute("select column_name, data_type, column_default from information_schema.columns where table_name='os_claude_requests' and column_name in ('attempts','seen_at','created_by') order by 1")
    cols = {r[0]: r for r in cur.fetchall()}
    check("columns attempts/seen_at/created_by", set(cols) == {"attempts", "seen_at", "created_by"}, str(cols))
    cur.execute("select indexdef from pg_indexes where indexname='os_claude_requests_open_task_uq'"); check("partial unique index", "WHERE" in (cur.fetchone() or [""])[0])
    cur.execute("select reloptions from pg_class where relname='os_campaign_daily'"); check("os_campaign_daily security_invoker", "security_invoker=true" in str(cur.fetchone()))
    cur.execute("select count(*) from pg_constraint where convalidated is false and conrelid::regclass::text like '%os_%'"); check("all checks validated", cur.fetchone()[0] == 0)
    cur.execute("select polname, pg_get_expr(polqual, polrelid) from pg_policy where polname like '%owner_all'")
    pols = cur.fetchall(); check("13 owner policies use (select os_is_owner())", len(pols) == 13 and all("SELECT os_is_owner()" in (q or "") or "select" in (q or "").lower() for _, q in pols), str(pols[:1]))

    # ---- seed a task
    as_postgres()
    tid = str(uuid.uuid4()); cur.execute("insert into os_tasks(id,title) values (%s,'t1')", (tid,))
    # ---- owner insert stamps created_by, client-sent created_by/attempts ignored
    as_user(OWNER)
    r1 = str(uuid.uuid4())
    cur.execute("insert into os_claude_requests(id,area,task_id,title,brief,created_by,attempts) values (%s,'work',%s,'x','do it',%s,7) returning created_by, attempts, status", (r1, tid, STRANGER))
    cb, att, st = cur.fetchone(); check("owner insert: created_by = owner, attempts 0, queued", str(cb) == OWNER and att == 0 and st == "queued", f"{cb} {att} {st}")
    check("second open request for same task -> 23505", err("insert into os_claude_requests(area,task_id,title,brief) values ('work',%s,'x','again')", (tid,)) == "23505")
    check("brief over 20000 chars -> 23514", err("insert into os_claude_requests(area,title,brief) values ('work','x',%s)", ("a" * 20001,)) == "23514")
    check("brief of 20000 chars ok", err("insert into os_claude_requests(area,title,brief) values ('work','x',%s)", ("a" * 20000,)) is None)
    check("app cannot claim (set firing) -> 42501", err("update os_claude_requests set status='firing' where id=%s", (r1,)) == "42501")
    as_postgres()
    check("poller: status firing allowed", err("update os_claude_requests set status='firing' where id=%s", (r1,)) is None)
    check("poller: status sent without sent_at -> 23514", err("update os_claude_requests set status='sent' where id=%s", (r1,)) == "23514")
    as_user(OWNER)
    check("owner cannot change created_by", err("update os_claude_requests set created_by=%s where id=%s", (STRANGER, r1)) is None)
    cur.execute("select created_by from os_claude_requests where id=%s", (r1,)); check("  ...created_by unchanged", str(cur.fetchone()[0]) == OWNER)
    check("owner cannot change owner_uid -> 42501", err("update os_settings set value='\"x\"' where key='owner_uid'") == "42501")
    check("owner cannot delete owner_uid -> 42501", err("delete from os_settings where key='owner_uid'") == "42501")
    check("owner can still upsert other settings", err("insert into os_settings(key,value) values ('k','1') on conflict (key) do update set value=excluded.value") is None)
    check("owner cannot truncate (no privilege) -> 42501", err("truncate os_tasks") == "42501")
    check("owner cannot read the ledger -> 42501", err("select * from os_schema_migrations") == "42501")
    check("owner reads os_campaign_daily", err("select * from os_campaign_daily") is None)
    # ---- stranger
    as_user(STRANGER)
    check("stranger insert refused", err("insert into os_claude_requests(area,title,brief) values ('work','x','y')") in ("42501",))
    cur.execute("select count(*) from os_claude_requests"); check("stranger reads 0 requests", cur.fetchone()[0] == 0)
    # ---- DB URL role (no auth.uid())
    as_postgres()
    check("DB-URL insert refused (no auth.uid) -> 42501", err("insert into os_claude_requests(area,title,brief) values ('work','x','y')") == "42501")
    check("DB-URL can change owner_uid (migrations still can)", err("update os_settings set value=value where key='owner_uid'") is None)
    # ---- anon
    cur.execute("set role anon")
    check("anon cannot read os_campaign_daily", err("select * from os_campaign_daily") == "42501")
    as_postgres()
    # ---- daily view: 3 snapshots on one IST day + 1 the next day -> 2 rows, last one per day
    cur.execute("""insert into os_campaign_snapshots(taken_at,channel,account,campaign_id,campaign_name,sent_total) values
       (now() - interval '2 days' , 'email','instantly','c1','C1',10),
       (now() - interval '2 days' + interval '1 minute', 'email','instantly','c1','C1',11),
       (now() - interval '40 days', 'email','instantly','c1','C1',1),
       (now(), 'email','instantly','c1','C1',20)""")
    cur.execute("select ist_day, sent_total from os_campaign_daily where campaign_id='c1' order by taken_at")
    rows = cur.fetchall(); check("daily view: one row per IST day, last snapshot, 31 days", [r[1] for r in rows] == [11, 20], str(rows))
    # ---- task delete strips top_task_ids
    cur.execute("insert into os_days(day, top_task_ids) values (current_date, array[%s]::uuid[])", (tid,))
    cur.execute("delete from os_tasks where id=%s", (tid,))
    cur.execute("select top_task_ids from os_days where day=current_date"); check("deleted task removed from top_task_ids", cur.fetchone()[0] == [])
    check("finance currency check", err("insert into os_finance_entries(kind,label,amount,currency,month) values ('cost','x',1,'EUR','2026-10-01')") == "23514")
    check("finance month first-of-month check", err("insert into os_finance_entries(kind,label,amount,month) values ('cost','x',1,'2026-10-05')") == "23514")
    check("reminder repeat_days range check", err("insert into os_reminders(title,repeat,repeat_days,time_local) values ('r','custom','{7}','09:00')") == "23514")
    check("one-off reminder needs remind_at", err("insert into os_reminders(title,repeat) values ('r','none')") == "23514")
    check("done task needs completed_at", err("insert into os_tasks(title,status) values ('d','done')") == "23514")

    # ================================================================ 0008 (logs/qa-r2-plan.md contract)
    as_postgres()
    t8 = str(uuid.uuid4()); t9 = str(uuid.uuid4())
    cur.execute("insert into os_tasks(id,title) values (%s,'t8'),(%s,'t9')", (t8, t9))
    # ---- R2S01 a: forged claims from the DB URL
    as_forged(OWNER)
    check("0008 forged owner claims from the DB URL -> 42501", err("insert into os_claude_requests(area,title,brief) values ('work','x','forged')") == "42501")
    # ---- the app's two insert shapes
    as_user(OWNER)
    q8 = str(uuid.uuid4()); c8 = str(uuid.uuid4())
    check("0008 owner queues a routine request", err("insert into os_claude_requests(id,area,task_id,title,brief) values (%s,'work',%s,'q','do it')", (q8, t8)) is None)
    cur.execute("insert into os_claude_requests(id,area,task_id,title,brief,status,handoff,result,seen_at) values (%s,'work',%s,'c','copied','sent','copy','fake',now()) returning status, sent_at is not null, result, seen_at", (c8, t9))
    st, has_sent, res8, seen8 = cur.fetchone()
    check("0008 copy hand-off: sent, sent_at set, result/seen_at cleared", st == "sent" and has_sent and res8 is None and seen8 is None)
    check("0008 insert as done -> 23514", err("insert into os_claude_requests(area,title,brief,status) values ('work','x','y','done')") == "23514")
    check("0008 copy hand-off with status queued -> 23514", err("insert into os_claude_requests(area,title,brief,handoff) values ('work','x','y','copy')") == "23514")
    # ---- immutability
    check("0008 brief cannot change -> 42501", err("update os_claude_requests set brief='rewritten' where id=%s", (q8,)) == "42501")
    check("0008 title cannot change -> 42501", err("update os_claude_requests set title='rewritten' where id=%s", (q8,)) == "42501")
    check("0008 task_id cannot move to another task -> 42501", err("update os_claude_requests set task_id=%s where id=%s", (t9, q8)) == "42501")
    check("0008 app cannot change attempts -> 42501", err("update os_claude_requests set attempts=5 where id=%s", (q8,)) == "42501")
    check("0008 app finishes a copy hand-off", err("update os_claude_requests set status='done', finished_at=now() where id=%s", (c8,)) is None)
    check("0008 app marks a finished row seen", err("update os_claude_requests set seen_at=now(), updated_at=now() where id=%s", (c8,)) is None)
    check("0008 finished row cannot be re-queued by the app -> 42501", err("update os_claude_requests set status='queued' where id=%s", (c8,)) == "42501")
    check("0008 finished row result cannot change -> 42501", err("update os_claude_requests set result='x' where id=%s", (c8,)) == "42501")
    # ---- R2S01 b: the DB URL turns an old row back into a queued one
    as_postgres()
    check("0008 DB URL cannot re-queue a finished row -> 42501", err("update os_claude_requests set status='queued', attempts=0 where id=%s", (c8,)) == "42501")
    check("0008 DB URL cannot rewrite a brief -> 42501", err("update os_claude_requests set brief='injected' where id=%s", (q8,)) == "42501")
    check("0008 poller: queued -> firing", err("update os_claude_requests set status='firing', attempts=attempts+1 where id=%s", (q8,)) is None)
    check("0008 poller: firing -> queued (retry)", err("update os_claude_requests set status='queued' where id=%s", (q8,)) is None)
    check("0008 queued -> sent skipping firing -> 42501", err("update os_claude_requests set status='sent', sent_at=now() where id=%s", (q8,)) == "42501")
    check("0008 session link must be claude.ai -> 23514", err("update os_claude_requests set status='firing' where id=%s", (q8,)) is None
          and err("update os_claude_requests set status='sent', sent_at=now(), session_url='https://claude.ai.evil.example/s/1' where id=%s", (q8,)) == "23514")
    check("0008 claude.ai session link ok", err("update os_claude_requests set status='sent', sent_at=now(), session_url='https://claude.ai/code/session_1' where id=%s", (q8,)) is None)
    cur.execute("delete from os_tasks where id=%s", (t9,))
    cur.execute("select task_id from os_claude_requests where id=%s", (c8,))
    check("0008 task delete still nulls task_id on a finished request", cur.fetchone()[0] is None)
    # ---- server keys, fire log
    as_user(OWNER)
    check("0008 app cannot write claude_routine -> 42501", err("insert into os_settings(key,value) values ('claude_routine','{\"linked\":true}') on conflict (key) do update set value=excluded.value") == "42501")
    check("0008 app cannot write claude_fire_budget -> 42501", err("insert into os_settings(key,value) values ('claude_fire_budget','1000000') on conflict (key) do update set value=excluded.value") == "42501")
    check("0008 app cannot write the fire log -> 42501", err("insert into os_claude_fires(request_id) values (%s)", (q8,)) == "42501")
    check("0008 app reads the fire log", err("select count(*) from os_claude_fires") is None)
    as_postgres()
    check("0008 poller writes claude_routine", err("insert into os_settings(key,value) values ('claude_routine','{}') on conflict (key) do update set value=excluded.value") is None)
    check("0008 poller writes the fire log", err("insert into os_claude_fires(request_id) values (%s)", (q8,)) is None)
    # ---- push endpoints
    as_user(OWNER)
    check("0008 push endpoint on an unknown host -> 23514", err("insert into os_push_subscriptions(endpoint,p256dh,auth) values ('https://127.0.0.1/x','a','b')") == "23514")
    check("0008 push endpoint on fcm ok", err("insert into os_push_subscriptions(endpoint,p256dh,auth) values ('https://fcm.googleapis.com/fcm/send/abc','a','b')") is None)
    check("0008 push endpoint on mozilla ok", err("insert into os_push_subscriptions(endpoint,p256dh,auth) values ('https://updates.push.services.mozilla.com/wpush/v2/x','a','b')") is None)
    # ---- snooze copies
    r8 = str(uuid.uuid4())
    cur.execute("insert into os_reminders(id,title,repeat,time_local) values (%s,'daily','daily','09:00')", (r8,))
    cur.execute("insert into os_reminders(title,repeat,remind_at,snooze_of) values ('daily','none',now()+interval '10 min',%s)", (r8,))
    cur.execute("delete from os_reminders where id=%s", (r8,))
    cur.execute("select count(*) from os_reminders where snooze_of=%s", (r8,)); check("0008 snooze copy goes with its reminder", cur.fetchone()[0] == 0)
    # ---- 24 h baseline view
    as_postgres()
    cur.execute("""insert into os_campaign_snapshots(taken_at,channel,account,campaign_id,campaign_name,sent_total) values
       (now() - interval '30 hours','email','instantly','b1','B1',5), (now() - interval '25 hours','email','instantly','b1','B1',7),
       (now() - interval '2 hours','email','instantly','b1','B1',9), (now() - interval '50 hours','email','instantly','b1','B1',1)""")
    as_user(OWNER)
    cur.execute("select sent_total from os_campaign_baseline24 where campaign_id='b1'")
    check("0008 baseline24 = newest row 24-48 h ago", [r[0] for r in cur.fetchall()] == [7])
    cur.execute("set role anon"); check("0008 anon cannot read baseline24", err("select * from os_campaign_baseline24") == "42501")
    # ---- function privileges
    as_postgres()
    cur.execute("""select p.proname, has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p
                   join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'os\\_%' order by 1""")
    priv = dict(cur.fetchall())
    check("0008 only os_is_owner is executable by authenticated", priv.get("os_is_owner") is True and not any(v for k, v in priv.items() if k != "os_is_owner"), str(priv))
    cur.execute("select count(*) from pg_constraint where convalidated is false and conrelid::regclass::text like '%os_%'"); check("0008 all checks validated", cur.fetchone()[0] == 0)

    # ================================================================ 0010 (logs/qa-r4-plan.md contract)
    as_postgres()
    cal = str(uuid.uuid4())
    cur.execute("insert into os_calendar_events(id,title,starts_at,ends_at) values ('ev1','t',now(),now())")
    cur.execute("insert into os_calendar_links(task_id,event_id,sig) values (%s,'ev1','s')", (cal,))
    cur.execute("select linked, last_ok_at, problem, counted_on, clears_today, writes_today from os_calendar_state"); check("0010 one state row, not linked, nothing counted", cur.fetchall() == [(False, None, None, None, 0, 0)])
    check("0010 a second state row -> 23514", err("insert into os_calendar_state(id) values (false)") == "23514")
    check("0010 html_link on another host -> 23514", err("update os_calendar_events set html_link='https://www.google.com.evil.example/calendar/x' where id='ev1'") == "23514")
    check("0010 meet_link on another host -> 23514", err("update os_calendar_events set meet_link='javascript:alert(1)' where id='ev1'") == "23514")
    check("0010 a Meet link that is not a meeting code -> 23514", err("update os_calendar_events set meet_link='https://meet.google.com/linkredirect?dest=https://evil.example' where id='ev1'") == "23514")
    check("0010 both Google links ok", err("update os_calendar_events set html_link='https://www.google.com/calendar/event?eid=a', meet_link='https://meet.google.com/abc-defg-hij' where id='ev1'") is None)
    check("0010 timed and all day at once -> 23514", err("update os_calendar_events set all_day_from=current_date, all_day_to=current_date+1 where id='ev1'") == "23514")
    check("0010 no times at all -> 23514", err("insert into os_calendar_events(id) values ('ev2')") == "23514")
    check("0010 all day row ok", err("insert into os_calendar_events(id,all_day_from,all_day_to) values ('ev3',current_date,current_date+1)") is None)
    check("0010 one link per event -> 23505", err("insert into os_calendar_links(task_id,event_id,sig) values (%s,'ev1','s')", (str(uuid.uuid4()),)) == "23505")
    CAL_WRITES = {
        "os_calendar_events": ("insert into os_calendar_events(id,starts_at,ends_at) values ('evil',now(),now())", "update os_calendar_events set title='x'", "delete from os_calendar_events"),
        "os_calendar_links": (f"insert into os_calendar_links(task_id,event_id,sig) values ('{uuid.uuid4()}','evil','s')", "update os_calendar_links set sig='x'", "delete from os_calendar_links"),
        "os_calendar_state": ("insert into os_calendar_state(id) values (true)", "update os_calendar_state set linked=true", "delete from os_calendar_state"),
    }
    for t, writes in CAL_WRITES.items():
        as_user(OWNER)
        if t == "os_calendar_links":
            check(f"0010 owner cannot read {t} -> 42501", err(f"select * from {t}") == "42501")
        else:
            cur.execute(f"select count(*) from {t}"); check(f"0010 owner reads {t}", cur.fetchone()[0] >= 1)
        for sql in writes:
            check(f"0010 owner cannot {sql.split()[0]} {t} -> 42501", err(sql) == "42501")
        check(f"0010 owner cannot truncate {t} -> 42501", err(f"truncate {t}") == "42501")
        as_user(STRANGER)
        if t == "os_calendar_links":
            check(f"0010 stranger cannot read {t} -> 42501", err(f"select * from {t}") == "42501")
        else:
            cur.execute(f"select count(*) from {t}"); check(f"0010 stranger reads 0 rows of {t}", cur.fetchone()[0] == 0)
        for sql in writes:
            check(f"0010 stranger cannot {sql.split()[0]} {t} -> 42501", err(sql) == "42501")
        as_postgres(); cur.execute("set role anon")
        check(f"0010 anon cannot read {t} -> 42501", err(f"select * from {t}") == "42501")
        for sql in writes:
            check(f"0010 anon cannot {sql.split()[0]} {t} -> 42501", err(sql) == "42501")
        as_postgres()
    cur.execute("delete from os_calendar_links"); cur.execute("delete from os_calendar_events")
    cur.execute("select relname from pg_class where relname like 'os\\_calendar\\_%' and relkind='r' and not relrowsecurity"); check("0010 row level security on all three", cur.fetchall() == [])

    # ================================================================ R3S01: the guard by result
    # Each of these got past the text lint in QA round 3. Run inside a transaction, check, roll back.
    as_postgres()
    conn.autocommit = False
    owner_now = apply.owner_uid_value(cur); conn.rollback()
    BYPASSES = {
        "touch function rewritten": "create or replace function public.os_touch_updated_at() returns trigger language plpgsql set search_path = '' as $$ begin new.status := 'queued'; new.updated_at = now(); return new; end $$",
        "lock trigger in replica mode": "alter table public.os_claude_requests enable replica trigger os_claude_requests_lock",
        "comment inside keywords": "alter table public.os_settings disable/**/trigger os_settings_guard_owner_uid",
        "concatenated dynamic SQL": "do $x$ begin execute 'dr'||'op trigger os_claude_requests_lock on public.os_claude_requests'; end $x$",
        "a rule": "create rule os_r as on update to public.os_claude_requests do also select 1",
        "a trigger after the lock": "create function public.os_zz() returns trigger language plpgsql as $$ begin return new; end $$; create trigger zz before update on public.os_claude_requests for each row execute function public.os_zz()",
        "policy is not null": "alter policy os_notes_owner_all on public.os_notes using ((select public.os_is_owner()) is not null)",
        "policy for anon": "alter policy os_notes_owner_all on public.os_notes to anon, authenticated",
        "rls off by alter": "alter table public.os_notes disable row level security",
        "weaker push hosts": "alter table public.os_push_subscriptions drop constraint os_push_endpoint_host, add constraint os_push_endpoint_host check (endpoint ~ '^https://')",
        "authenticated gets postgres": "grant postgres to authenticated",
        "callable definer": "create function public.leak() returns setof public.os_notes language sql security definer set search_path = public as $$ select * from public.os_notes $$; grant execute on function public.leak() to authenticated",
        "owner swapped": "update public.os_settings set value = to_jsonb('00000000-0000-0000-0000-000000000000'::text) where key = 'owner_uid'",
        "anon reads a view": "grant select on public.os_campaign_daily to anon",
        "app can write the mirror": "grant insert on public.os_calendar_events to authenticated",
        "app can write the links": "grant update on public.os_calendar_links to authenticated",
        "app can read the links": "grant select on public.os_calendar_links to authenticated",
        "app can write the state": "grant update on public.os_calendar_state to authenticated",
        "anon reads the mirror": "grant select on public.os_calendar_events to anon",
        "calendar policy for all": "drop policy os_calendar_links_owner_read on public.os_calendar_links; create policy os_calendar_links_owner_read on public.os_calendar_links for all to authenticated using ((select public.os_is_owner())) with check ((select public.os_is_owner()))",
        "weaker calendar link": "alter table public.os_calendar_events drop constraint os_calendar_events_html_link_host, add constraint os_calendar_events_html_link_host check (html_link ~ '^https://')",
        "calendar link check gone": "alter table public.os_calendar_events drop constraint os_calendar_events_meet_link_host",
    }
    for label, sql in BYPASSES.items():
        try:
            cur.execute(sql)
            drift = apply.catalog_problems(cur, owner_now)
            check(f"R3S01 caught by result: {label}", bool(drift), "; ".join(drift[:2]))
        except Exception as e:
            check(f"R3S01 caught by result: {label}", False, f"setup failed {type(e).__name__}: {e}")
        conn.rollback()
    check("R3S01 a clean database has no drift", not apply.catalog_problems(cur, owner_now))
    conn.rollback()
    conn.autocommit = True

print(f"\n{sum(ok for _, ok in res)}/{len(res)} checks passed")
sys.exit(0 if all(ok for _, ok in res) else 1)
