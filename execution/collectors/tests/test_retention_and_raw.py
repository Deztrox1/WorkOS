"""Snapshot slimming (QA r1 D8) and retention (D8, D19).
Pure tests always run; the retention test needs WOS_TEST_DB_URL = a localhost throwaway Postgres with 0001-0007."""
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import _common as c  # noqa: E402
import retention  # noqa: E402


def test_full_raw_first_then_slim_while_unchanged():
    raw = {"campaign": {"id": "c1", "name": "A", "sequences": ["long body"]}, "analytics": {"sent": 5}, "playbook_status": "active"}
    first = c.slim_raw(raw, None)
    assert first["campaign"]["sequences"] == ["long body"] and first["playbook_status"] == "active"
    again = c.slim_raw(dict(raw, analytics={"sent": 9}), first["hash"])       # counters moved, object did not
    assert again == {"playbook_status": "active", "hash": first["hash"], "same_as_previous": True}
    changed = c.slim_raw(dict(raw, campaign={"id": "c1", "name": "B"}), first["hash"])
    assert changed["campaign"]["name"] == "B" and changed["hash"] != first["hash"]


def test_ghl_raw_keeps_location_id():
    w = {"id": "w1", "status": "published", "location_id": "LOC"}
    h = c.slim_raw(w, None)["hash"]
    assert c.slim_raw(w, h) == {"location_id": "LOC", "hash": h, "same_as_previous": True}


DB = os.environ.get("WOS_TEST_DB_URL", "")


@pytest.mark.skipif(not DB or not any(h in DB for h in ("127.0.0.1", "localhost")), reason="needs a localhost throwaway DB")
def test_retention_keeps_last_per_old_day_and_all_recent():
    import psycopg
    today = date(2026, 10, 28)
    ist = timezone(timedelta(hours=5, minutes=30))
    with psycopg.connect(DB, cursor_factory=psycopg.ClientCursor) as conn, conn.cursor() as cur:
        cur.execute("reset role")
        cur.execute("delete from os_campaign_snapshots where campaign_id like 'ret-%'")
        def snap(day, hh, cid="ret-1", sent=0):
            cur.execute("""insert into os_campaign_snapshots(taken_at,channel,account,campaign_id,campaign_name,sent_total)
                           values (%s,'email','instantly',%s,'R',%s)""", (datetime.combine(day, datetime.min.time(), ist) + timedelta(hours=hh), cid, sent))
        old = today - timedelta(days=20)
        for hh in (1, 5, 23):
            snap(old, hh, sent=hh)
        recent = today - timedelta(days=3)
        for hh in (1, 5, 23):
            snap(recent, hh, sent=hh)
        assert retention.prune(cur, dry=True, today=today)["snapshots"] >= 2
        assert retention.prune(cur, today=today)["snapshots"] >= 2
        cur.execute("select (taken_at at time zone 'Asia/Kolkata')::date, sent_total from os_campaign_snapshots where campaign_id='ret-1' order by taken_at")
        got = cur.fetchall()
        assert got == [(old, 23)] + [(recent, h) for h in (1, 5, 23)]
        assert retention.prune(cur, today=today)["snapshots"] == 0            # idempotent
        cur.execute("delete from os_campaign_snapshots where campaign_id like 'ret-%'")
        conn.commit()


def test_connect_refuses_another_project(monkeypatch):
    monkeypatch.setenv("SUPABASE_DB_URL", "postgresql://postgres.someotherref:pw@aws-0.pooler.supabase.com:5432/postgres")
    with pytest.raises(SystemExit, match="does not name project"):
        c.connect()


# ---- QA r2: retention keeps full raw rows, finance skips odd currencies, heartbeat wording
def test_retention_sql_protects_full_raw_rows():
    assert "same_as_previous" in retention.SNAP_EXTRA and "raw is not null" in retention.SNAP_EXTRA
    assert "not exists" in retention.SNAP_EXTRA


def test_finance_skips_unknown_currency(capsys):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    import finance_pulse as f
    ledger = {"invoices": [
        {"invoice_no": "A1", "client": "northwind", "date": "2026-10-01", "total": 500, "currency": "GBP"},
        {"invoice_no": "A2", "client": "skillcamp", "date": "2026-10-02", "total": 9, "currency": "EUR"},
        {"invoice_no": "A3", "client": "skillcamp", "date": "2026-10-03", "total": 7},
    ]}
    got = {e["ref"]: e["currency"] for e in f.entries(ledger)}
    assert got == {"A1": "GBP", "A3": "USD"}
    assert "A2" in capsys.readouterr().out


def test_heartbeat_titles_are_plain():
    import ops_heartbeat as h
    ok = h.modal_result({c: "deployed" for c in h.CRONS})
    assert ok[1] == "Scheduled jobs are running"
    bad = h.modal_result({c: "deployed" for c in h.CRONS[1:]})
    assert bad[1] == f"Some scheduled jobs are off: {h.CRONS[0]}" and bad[3] == "bad"
    st, title, body, sev = h.unavailable_result("modal")
    assert (title, body) == ("The modal check cannot run in the cloud", "It needs your laptop. It is skipped for now.")
    for t in (ok[1], bad[1], title, body):
        assert "—" not in t and "!" not in t


def test_watchdog_calendar_stale():
    import watchdog as w
    now = datetime(2026, 11, 7, 6, 0, tzinfo=timezone.utc)
    ran = now - timedelta(minutes=2)
    assert w.calendar_stale(True, ran, ran, now) is False
    assert w.calendar_stale(True, now - timedelta(minutes=29), now - timedelta(minutes=29), now) is False
    assert w.calendar_stale(True, ran, now - timedelta(minutes=31), now) is True      # the unit stopped
    assert w.calendar_stale(True, ran, None, now) is True
    assert w.calendar_stale(True, None, ran, now) is True                             # linked, and never one good run
    assert w.calendar_stale(False, None, None, now) is False                          # not linked: nothing to watch
    assert w.calendar_stale(False, now - timedelta(days=9), now - timedelta(days=9), now) is False


def test_watchdog_gives_a_problem_only_the_owner_can_fix_six_hours():
    """R4X08: the unit keeps writing while it waits for a new sign in, and the app has said so. Red every hour would hide
    a real collector failure. Past 6 hours it goes red, in case the app's words were missed."""
    import watchdog as w
    now = datetime(2026, 11, 7, 6, 0, tzinfo=timezone.utc)
    ran = now - timedelta(minutes=2)
    assert w.calendar_stale(True, now - timedelta(hours=2), ran, now) is False
    assert w.calendar_stale(True, now - timedelta(hours=5, minutes=59), ran, now) is False
    assert w.calendar_stale(True, now - timedelta(hours=6, minutes=1), ran, now) is True


class _WatchCursor:
    """Answers the three watchdog reads in order; `table` None means migration 0010 is not on this database."""
    def __init__(self, at, table, calendar): self.at, self.table, self.calendar, self.last, self.asked = at, table, calendar, "", []
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def execute(self, sql, args=()): self.last = sql; self.asked.append(sql)
    def fetchone(self):
        if "push_last_run" in self.last:
            return (self.at,)
        return (self.table,) if "to_regclass" in self.last else self.calendar


class _WatchConn:
    def __init__(self, cur): self.cur = cur
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def cursor(self): return self.cur


def watch(monkeypatch, capsys, sender_age, table, calendar):
    import _common
    import watchdog as w
    at = (datetime.now(timezone.utc) - sender_age).isoformat()
    cur = _WatchCursor(at, table, calendar)
    monkeypatch.setattr(_common, "connect", lambda: _WatchConn(cur))
    monkeypatch.setattr(w.sys, "argv", ["watchdog.py", "check"])
    return w.main(), capsys.readouterr().out, cur


def test_watchdog_check_fails_on_a_stopped_calendar(monkeypatch, capsys):
    fresh, old, now = timedelta(minutes=1), datetime.now(timezone.utc) - timedelta(hours=2), datetime.now(timezone.utc)
    rc, out, cur = watch(monkeypatch, capsys, fresh, "os_calendar_state", (True, old, old))
    assert rc == 1 and "calendar last checked at" in out and "last ran at" in out
    assert any("updated_at" in q for q in cur.asked)
    rc, _, _ = watch(monkeypatch, capsys, fresh, "os_calendar_state", (True, now, now))
    assert rc == 0


def test_watchdog_check_stays_green_while_the_calendar_waits_for_the_owner(monkeypatch, capsys):
    now = datetime.now(timezone.utc)
    rc, _, _ = watch(monkeypatch, capsys, timedelta(minutes=1), "os_calendar_state", (True, now - timedelta(hours=2), now))
    assert rc == 0
    rc, out, _ = watch(monkeypatch, capsys, timedelta(minutes=1), "os_calendar_state", (True, None, now))
    assert rc == 1 and "calendar last checked at never" in out


def test_watchdog_check_ignores_a_calendar_that_was_never_linked(monkeypatch, capsys):
    rc, out, _ = watch(monkeypatch, capsys, timedelta(minutes=1), "os_calendar_state", (False, None, datetime.now(timezone.utc)))
    assert rc == 0 and "calendar" not in out


def test_watchdog_check_runs_before_migration_0010(monkeypatch, capsys):
    rc, _, cur = watch(monkeypatch, capsys, timedelta(minutes=1), None, None)
    assert rc == 0 and not any("os_calendar_state where" in q for q in cur.asked)


def test_watchdog_check_still_watches_the_sender(monkeypatch, capsys):
    rc, _, _ = watch(monkeypatch, capsys, timedelta(minutes=30), None, None)
    assert rc == 1


def test_watchdog_sender_stale():
    import watchdog as w
    now = datetime(2026, 10, 29, 12, 0, tzinfo=timezone.utc)
    assert w.sender_stale(None, now) and w.sender_stale("garbage", now)
    assert not w.sender_stale((now - timedelta(minutes=3)).isoformat(), now)
    assert w.sender_stale((now - timedelta(minutes=11)).isoformat(), now)
    title, body = w.failed_event("Campaign pulse")
    assert title == "The cloud check failed" and "Campaign pulse" in body and "!" not in body
