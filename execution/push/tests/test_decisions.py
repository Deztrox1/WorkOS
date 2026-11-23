import sys
from datetime import date, datetime, time, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "shared"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from next_fire import IST  # noqa: E402
import push_due as p  # noqa: E402

NOW = datetime(2026, 10, 22, 8, 31, tzinfo=IST)     # Thursday


def test_reminder_fires_once_in_grace_window():
    r = dict(repeat="daily", remind_at=None, time_local=time(8, 30), repeat_days=[], last_fired_at=None)
    assert p.reminder_due(r, NOW) == datetime(2026, 10, 22, 8, 30, tzinfo=IST)
    r["last_fired_at"] = NOW
    assert p.reminder_due(r, NOW + timedelta(minutes=1)) is None


def test_reminder_old_slot_is_skipped_beyond_grace():
    r = dict(repeat="daily", remind_at=None, time_local=time(8, 30), repeat_days=[], last_fired_at=None)
    assert p.reminder_due(r, NOW + timedelta(hours=2)) is None


def test_one_off_fires_late_not_never():
    r = dict(repeat="none", remind_at=datetime(2026, 10, 20, 9, 0, tzinfo=IST), time_local=None, repeat_days=[], last_fired_at=None)
    assert p.reminder_due(r, NOW) is not None


def test_habit_states():
    h = dict(time_local=time(8, 0), days=[4], last_pushed_on=None)           # Thursday = 4
    assert p.habit_due(h, NOW, False) == "push"
    assert p.habit_due(h, NOW, True) == "mark"
    assert p.habit_due(dict(h, last_pushed_on=date(2026, 10, 22)), NOW, False) is None
    assert p.habit_due(dict(h, days=[1]), NOW, False) is None
    assert p.habit_due(h, NOW.replace(hour=13), False) == "mark"             # past the 3 h window
    assert p.habit_due(dict(h, time_local=time(9, 0)), NOW, False) is None   # not yet


def test_task_due():
    t = dict(due_date=date(2026, 10, 22), due_time=time(8, 0), pushed_at=None)
    assert p.task_due(t, NOW) == "push"
    assert p.task_due(dict(t, due_date=date(2026, 10, 20)), NOW) == "mark"
    assert p.task_due(dict(t, due_time=time(9, 0)), NOW) is None
    assert p.task_due(dict(t, pushed_at=NOW), NOW) is None


def test_digest_window():
    assert p.digest_due(NOW, None) is True
    assert p.digest_due(NOW, "2026-10-22") is False
    assert p.digest_due(NOW.replace(hour=7), None) is False
    assert p.digest_due(NOW.replace(hour=13), None) is False


# ---- delivery rules (QA r1 D3, D11)
def test_should_mark():
    due = NOW - timedelta(minutes=1)
    assert p.should_mark("delivered", NOW, due) is True
    assert p.should_mark("none", NOW, due) is True                 # nobody subscribed: record, never loop
    assert p.should_mark("failed", NOW, due) is False              # retried next minute
    assert p.should_mark("capped", NOW, due) is False
    assert p.should_mark("failed", NOW, NOW - timedelta(minutes=16)) is True   # past GRACE: give up
    assert p.should_mark("failed", NOW, None) is True


def test_sender_outcomes(monkeypatch):
    import pywebpush

    class R:
        status_code = 500

    calls = []

    def fake(subscription_info, **kw):
        calls.append(subscription_info["endpoint"])
        if "bad" in subscription_info["endpoint"]:
            raise pywebpush.WebPushException("x", response=R())
        if "gone" in subscription_info["endpoint"]:
            r = R(); r.status_code = 410
            raise pywebpush.WebPushException("gone", response=r)

    monkeypatch.setattr(pywebpush, "webpush", fake)
    monkeypatch.setenv("VAPID_PRIVATE_KEY", "k")
    sub = lambda e: {"endpoint": f"https://fcm.googleapis.com/{e}", "p256dh": "p", "auth": "a"}  # noqa: E731
    assert p.Sender([], False).send("t", "b", "tag") == "none"
    assert p.Sender([sub("ok")], True).send("t", "b", "tag") == "none"          # dry run
    assert p.Sender([sub("ok"), sub("bad")], False).send("t", "b", "tag") == "delivered"
    assert p.Sender([sub("bad")], False).send("t", "b", "tag") == "failed"
    s = p.Sender([sub("gone")], False)
    assert s.send("t", "b", "tag") == "none" and s.removed == ["https://fcm.googleapis.com/gone"]          # nobody left to receive it
    s = p.Sender([sub("ok")], False)
    s.sent = p.MAX_SENDS
    assert s.send("t", "b", "tag") == "capped"


def test_push_due_no_longer_fires_claude():
    assert "claude_fire" not in Path(p.__file__).read_text().split('"""', 2)[2]


# ---- QA r2: endpoint allow-list (S10), snooze copies (P10), the 08:00 message (C03)
def test_endpoint_allow_list():
    ok = ["https://fcm.googleapis.com/fcm/send/abc", "https://updates.push.services.mozilla.com/wpush/v2/x",
          "https://web.push.apple.com/Qx", "https://wns2-par02p.notify.windows.com/w/?token=1"]
    for u in ok:
        assert p.endpoint_allowed(u), u
    bad = ["http://fcm.googleapis.com/x", "https://127.0.0.1/x", "https://localhost/x", "https://10.0.0.5/x",
           "https://fcm.googleapis.com.evil.example/x", "https://evilfcm.googleapis.com/x", "https://push.services.mozilla.com/x",
           "https://evil.example/web.push.apple.com", "https://user@evil.example/x", "ftp://fcm.googleapis.com/x", "", None, "not a url"]
    for u in bad:
        assert not p.endpoint_allowed(u), u
    assert p.host_of("https://10.0.0.5/secret/path?x=1") == "10.0.0.5"


def test_sender_never_posts_to_a_bad_endpoint(monkeypatch, capsys):
    monkeypatch.setenv("VAPID_PRIVATE_KEY", "k")
    s = p.Sender([{"endpoint": "https://127.0.0.1/secret?t=1", "p256dh": "a", "auth": "b"}], False)
    assert s.send("t", "b", "tag") == "none"
    out = capsys.readouterr().out
    assert "127.0.0.1" in out and "secret" not in out


T = lambda i, title, due=None: dict(id=i, title=title, due_time=due)  # noqa: E731


def test_order_planned_pick_order_then_time_then_rest():
    tasks = [T("c", "Zed"), T("b", "Call", time(15, 0)), T("a", "Alpha"), T("d", "Early", time(9, 0))]
    assert [t["id"] for t in p.order_planned(tasks, ["a", "c"])] == ["a", "c", "d", "b"]
    assert [t["id"] for t in p.order_planned(tasks, [])] == ["d", "b", "a", "c"]


def test_digest_with_a_plan():
    planned = [T("a", "Ship the proposal"), T("b", "Call Sam"), T("c", "Invoice")]
    assert p.digest_message(planned, [], 9) == ("First: Ship the proposal", "Then 2 more.")
    assert p.digest_message(planned[:1], [], 9) == ("First: Ship the proposal", "Nothing else planned.")
    assert p.digest_message(planned, [], 9, 4) == ("First: Ship the proposal", "Then 2 more. 4 things on your calendar.")
    assert p.digest_message(planned[:1], [], 9, 1) == ("First: Ship the proposal", "1 thing on your calendar.")


def test_digest_skips_tasks_claude_holds_for_first():
    planned = [T("a", "Held"), T("b", "Free")]
    assert p.digest_message(planned, ["a"], 0) == ("First: Free", "Then 1 more.")


def test_digest_without_a_plan():
    assert p.digest_message([], [], 12) == ("Good morning", "Nothing picked yet. Pick from 12 older tasks on Today.")
    assert p.digest_message([], [], 0) == ("Good morning", "Nothing picked yet. Open Today to pick some.")
    # every planned task is with Claude: the plan exists, so the push must not call it empty (QA r3 C09)
    assert p.digest_message([T("a", "Held")], ["a"], 5) == ("Good morning", "Everything picked is with Claude.")
    assert p.digest_message([T("a", "Held")], ["a"], 0)[0] == "Good morning"


def test_digest_counts_a_day_of_meetings_with_no_tasks():
    assert p.digest_message([], [], 12, 4) == ("Good morning", "Nothing picked yet. 4 things on your calendar.")
    assert p.digest_message([], [], 0, 1) == ("Good morning", "Nothing picked yet. 1 thing on your calendar.")
    assert p.digest_message([T("a", "Held")], ["a"], 0, 2) == ("Good morning", "Everything picked is with Claude. 2 things on your calendar.")


def test_digest_never_says_sheet():
    for args in (([T("a", "X"), T("b", "Y")], [], 3), ([T("a", "X")], ["a"], 3), ([], [], 3), ([], [], 0), ([], [], 0, 2)):
        assert "sheet" not in " ".join(p.digest_message(*args))


class _Busy:
    """A cursor that answers to_regclass and the count, and keeps what it was asked."""
    def __init__(self, table, n=0): self.table, self.n, self.asked, self.last = table, n, [], ""
    def execute(self, sql, args=()): self.last = sql; self.asked.append((sql, args))
    def fetchone(self): return (self.table,) if "to_regclass" in self.last else (self.n,)


def test_busy_events_are_counted_on_the_ist_day_without_the_copies_of_tasks():
    cur = _Busy("os_calendar_events", 3)
    assert p.busy_events_today(cur, date(2026, 10, 22)) == 3
    sql, args = cur.asked[1]
    assert "busy and task_id is null" in sql
    assert args[0] == datetime(2026, 10, 22, 0, 0, tzinfo=IST) and args[1] == datetime(2026, 10, 23, 0, 0, tzinfo=IST)
    assert args[2:] == (date(2026, 10, 22), date(2026, 10, 22))


def test_the_digest_still_runs_before_migration_0010_is_on_the_database():
    cur = _Busy(None)
    assert p.busy_events_today(cur, date(2026, 10, 22)) == 0 and len(cur.asked) == 1


def test_digest_strings_follow_voice_rules():
    for t, b in (p.digest_message([T("a", "X"), T("b", "Y")], [], 3), p.digest_message([], [], 3), p.digest_message([], [], 0)):
        assert "—" not in t + b and "!" not in t + b


def test_snooze_copy_is_deleted_after_it_fires():
    """run() routes a reminder with snooze_of through a delete; checked on a fake cursor."""
    from datetime import timezone as tz

    class Cur:
        def __init__(self): self.sql, self.last = [], None
        def __enter__(self): return self
        def __exit__(self, *a): pass
        def execute(self, q, a=()):
            self.sql.append(q.strip().split("\n")[0])
            self.last = q
        @property
        def description(self):
            q = self.last
            if "os_reminders" in q and q.startswith("select *"):
                return [type("D", (), {"name": n}) for n in ("id", "title", "notes", "repeat", "remind_at", "time_local", "repeat_days", "last_fired_at", "active", "snooze_of")]
            return [type("D", (), {"name": "endpoint"})] if "os_push_subscriptions" in q else []
        def fetchall(self):
            q = self.last
            if q.startswith("select *") and "os_reminders" in q:
                return [("r1", "Plan tomorrow", None, "none", NOW - timedelta(minutes=2), None, [], None, True, "orig")]
            return []
        def fetchone(self): return (None,) if "max(taken_at)" in self.last else (0,)

    class Conn:
        def __init__(self): self.c = Cur(); self.commits = 0
        def cursor(self): return self.c
        def commit(self): self.commits += 1

    conn = Conn()
    p.run(conn, NOW)
    assert any(q.startswith("delete from os_reminders") for q in conn.c.sql)
    assert not any(q.startswith("update os_reminders") for q in conn.c.sql)


def test_stale_numbers_alert():
    fresh = NOW - timedelta(hours=11)
    old = NOW - timedelta(hours=13)
    assert p.stale_numbers_alert(fresh, NOW, None) is None
    assert p.stale_numbers_alert(None, NOW, None) is None
    assert p.stale_numbers_alert(old, NOW, "2026-10-22") is None            # already sent today
    title, body = p.stale_numbers_alert(old, NOW, "2026-10-21")
    assert title == "Campaign numbers are out of date"
    assert body == "The last check ran at 19:31, 21 Oct. Open Activity to see why."
    assert "—" not in body and "!" not in body
