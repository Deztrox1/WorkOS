#!/usr/bin/env python3
"""
push-due: every minute, send the Web Push messages WorkOS owes and record that it did (PRD 2, 5.5).
Runs as a systemd timer on the VPS (execution/push/install_vps.sh). Idempotent: every message is
guarded by a column that is written whether or not anyone was subscribed.

  reminders  active, next slot (shared/next_fire.py) in (max(last_fired_at, now - 15 min), now]
             -> push, set last_fired_at = now; a one-off then sets active = false. A snooze copy
             (snooze_of set) is deleted once it has fired (QA r2 P10).
             A one-off with no last_fired_at fires late rather than never.
  habits     active, has time_local, today (IST) is in days, last_pushed_on <> today, time passed
             (within 3 h) -> push unless today's log is done; always set last_pushed_on = today.
  tasks      open, due_date + due_time <= now (IST), pushed_at is null -> push, set pushed_at.
             A task more than 24 h past its time is marked pushed without a send.
  digest     one push at/after 08:00 IST (until 12:00): "First: <first planned task>" and how many more are
             planned, or "Good morning" when nothing is picked, plus how many busy calendar events today holds (the
             copies of tasks are not counted twice). Opens Today (QA r2 C03, r4 R4B08). Recorded in
             os_settings.push_digest_on.
  events     unread `bad` events with pushed_at null; one push per (source, title) key and none when a
             row of that key was pushed in the last 24 h (it waits, still unread, until the 24 h pass).
  watchdog   one alert per IST day when the newest os_campaign_snapshots row is over 12 h old (the hourly GitHub
             job is throttled to 3-8 h gaps, so 3 h would cry wolf): "Campaign numbers are out of date"
             (QA r1 I01). The same file stamps os_settings.push_last_run each run, which the collect job checks.
  always     every POST goes only to a known push host (PUSH_HOSTS); others are skipped and logged by host.
             write os_settings.push_last_run = {at, sent, subscriptions, ...}. Zero subscriptions skips the
             send only. A subscription answering 404 or 410 is deleted.

Delivery (QA r1 D3, D11, D12): every item is sent, marked and COMMITTED on its own, so a run killed mid-way
re-sends at most the one item in flight. An item is marked only when a subscription took the push (or
there is nobody to push to). A failed or capped send stays unmarked and is retried next minute while it
is within GRACE of its due moment; after that it is marked so a dead endpoint cannot loop forever.
The task update is guarded on pushed_at null and the same due date/time, so a time the user just moved
still pushes. Claude requests are fired by claude_fire.py in its own unit (workos-claude.timer).

Env: SUPABASE_DB_URL, VAPID_PRIVATE_KEY (raw base64url only; pywebpush 2.x rejects PEM), VAPID_PUBLIC_KEY, VAPID_SUBJECT (mailto:...).
Flags: --dry-run (decide and print, write nothing, send nothing), --now 2026-10-22T08:00:00+05:30 (testing).
"""
import argparse
import json
import os
import sys
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent
for cand in (HERE / "shared", HERE.parents[1] / "shared"):      # VPS: ./shared ; repo: ../../shared
    if (cand / "next_fire.py").is_file():
        sys.path.insert(0, str(cand))
        break
from next_fire import IST, next_fire  # noqa: E402

GRACE = timedelta(minutes=15)
MAX_SENDS = 20          # hard cap per run: a bug can never spam the phone
HABIT_WINDOW = timedelta(hours=3)
DIGEST_FROM, DIGEST_UNTIL = time(8, 0), time(12, 0)
# Push services a browser can register (mirrors the os_push_subscriptions endpoint check, QA r2 S10).
PUSH_HOSTS_EXACT = ("fcm.googleapis.com", "web.push.apple.com")
PUSH_HOSTS_SUFFIX = (".push.services.mozilla.com", ".notify.windows.com")
CLAUDE_OPEN = ("queued", "firing", "sent")


def db_weekday(d: date) -> int:
    return (d.weekday() + 1) % 7


# --------------------------------------------------------------- decisions (pure, unit-testable)
def reminder_due(r, now):
    """Return the slot (datetime) that is due now, or None. r: dict of os_reminders columns."""
    last = r.get("last_fired_at")
    if r["repeat"] == "none":
        after = last or datetime(2000, 1, 1, tzinfo=timezone.utc)
    else:
        after = max(last, now - GRACE) if last else now - GRACE
    slot = next_fire(r["repeat"], after, r.get("remind_at"), r.get("time_local"), r.get("repeat_days"))
    return slot if slot and slot <= now else None


def habit_due(h, now, today_done):
    """'push' | 'mark' (record only) | None."""
    today = now.date()
    if not h.get("time_local") or db_weekday(today) not in (h.get("days") or []):
        return None
    if h.get("last_pushed_on") == today:
        return None
    t = datetime.combine(today, h["time_local"], tzinfo=IST)
    if now < t:
        return None
    if today_done or now - t > HABIT_WINDOW:
        return "mark"
    return "push"


def task_due(t, now):
    """'push' | 'mark' | None for an open task with a due_time and no pushed_at."""
    if t.get("pushed_at") or not t.get("due_date") or not t.get("due_time"):
        return None
    when = datetime.combine(t["due_date"], t["due_time"], tzinfo=IST)
    if when > now:
        return None
    return "mark" if now - when > timedelta(hours=24) else "push"


def digest_due(now, done_on):
    return DIGEST_FROM <= now.timetz().replace(tzinfo=None) < DIGEST_UNTIL and done_on != str(now.date())


def endpoint_allowed(url):
    """True only for https on a known push service host. Anything else (a LAN address, localhost,
    a stranger's server) is never POSTed to from the VPS."""
    try:
        u = urlsplit(url or "")
        host = (u.hostname or "").lower()
    except ValueError:
        return False
    if u.scheme != "https" or not host:
        return False
    return host in PUSH_HOSTS_EXACT or any(host.endswith(x) and len(host) > len(x) for x in PUSH_HOSTS_SUFFIX)


def host_of(url):
    try:
        return urlsplit(url or "").hostname or "unknown"
    except ValueError:
        return "unknown"


def order_planned(tasks, top_ids):
    """Today's planned tasks in the order the owner would do them: his pick order (os_days.top_task_ids)
    first, then by due time (untimed last), then the rest in title order. tasks: dicts with id, title, due_time."""
    rank = {str(i): n for n, i in enumerate(top_ids or [])}

    def key(t):
        if str(t["id"]) in rank:
            return (0, rank[str(t["id"])], time(0), "")
        return (1 if t.get("due_time") else 2, 0, t.get("due_time") or time(0), t["title"])
    return sorted(tasks, key=key)


def digest_message(planned, claude_task_ids, older_count, busy=0):
    """(title, body) for the 08:00 push. planned: ordered tasks (order_planned). A task with an open Claude request is
    never First but still counts as planned. busy: today's calendar events that are not copies of tasks.
    Plain words, no guilt."""
    held = {str(i) for i in claude_task_ids}
    first = next((t for t in planned if str(t["id"]) not in held), None)
    calendar = f"{busy} thing{'s' if busy != 1 else ''} on your calendar." if busy else ""
    if first:
        k = len(planned) - 1
        if k:
            return f"First: {first['title']}", f"Then {k} more. {calendar}".strip()
        return f"First: {first['title']}", calendar or "Nothing else planned."
    if planned:   # every planned task is with Claude: the plan exists, so do not say it is empty
        return "Good morning", f"Everything picked is with Claude. {calendar}".strip()
    if calendar:
        return "Good morning", f"Nothing picked yet. {calendar}"
    if older_count > 0:
        return "Good morning", f"Nothing picked yet. Pick from {older_count} older task{'s' if older_count != 1 else ''} on Today."
    return "Good morning", "Nothing picked yet. Open Today to pick some."


def busy_events_today(cur, today):
    """Today's busy calendar events, without the copies of tasks. 0 until migration 0010 is on this database."""
    cur.execute("select to_regclass('public.os_calendar_events')")
    if not cur.fetchone()[0]:
        return 0
    start = datetime.combine(today, time(0), tzinfo=IST)
    cur.execute("""select count(*) from os_calendar_events where busy and task_id is null
                   and ((starts_at >= %s and starts_at < %s) or (all_day_from <= %s and all_day_to > %s))""",
                (start, start + timedelta(days=1), today, today))
    return cur.fetchone()[0]


STALE_AFTER = timedelta(hours=12)


def stale_numbers_alert(newest, now, done_on):
    """(title, body) when the newest campaign snapshot is over 12 h old and today's alert is not sent yet, else None.
    newest: datetime or None (no snapshots at all: nothing to say, the collector has never run)."""
    if newest is None or done_on == str(now.date()) or now - newest <= STALE_AFTER:
        return None
    at = newest.astimezone(IST)
    return ("Campaign numbers are out of date",
            f"The last check ran at {at:%H:%M}, {at.day} {at:%b}. Open Activity to see why.")


def should_mark(outcome, now, due_at):
    """Record an item as pushed? Yes when delivered or when nobody can receive it; a failed or capped send
    is retried while within GRACE of its due moment, then given up (marked) so it cannot loop."""
    if outcome in ("delivered", "none"):
        return True
    return due_at is None or now - due_at > GRACE


# --------------------------------------------------------------- sending
class Sender:
    def __init__(self, subs, dry):
        self.subs, self.dry, self.sent, self.failed, self.removed, self.capped = subs, dry, 0, 0, [], 0
        self.priv = os.environ.get("VAPID_PRIVATE_KEY", "")
        self.claims = {"sub": os.environ.get("VAPID_SUBJECT", "mailto:alex@example.com")}

    def send(self, title, body, tag, url="/#/"):
        """'delivered' (at least one subscription took it) | 'none' (dry run, no subscription or no key:
        nobody can receive it) | 'capped' (MAX_SENDS reached this run) | 'failed' (every subscription failed)."""
        if self.dry or not self.subs or not self.priv:
            return "none"
        if not any(endpoint_allowed(s["endpoint"]) for s in self.subs):
            # Nobody who can safely receive it: record the item rather than retry forever.
            for s in self.subs:
                print(f"[push] skipped an endpoint on host {host_of(s['endpoint'])}: not a known push service")
            return "none"
        if self.sent + self.failed >= MAX_SENDS:
            self.capped += 1
            return "capped"
        ok = 0
        import requests
        from pywebpush import WebPushException, webpush
        payload = json.dumps({"title": title, "body": body, "tag": tag, "url": url})
        for s in list(self.subs):
            if not endpoint_allowed(s["endpoint"]):
                self.failed += 1
                print(f"[push] skipped an endpoint on host {host_of(s['endpoint'])}: not a known push service")
                continue
            try:
                webpush(subscription_info={"endpoint": s["endpoint"], "keys": {"p256dh": s["p256dh"], "auth": s["auth"]}},
                        data=payload, vapid_private_key=self.priv, vapid_claims=dict(self.claims), ttl=3600, timeout=10)
                self.sent += 1
                ok += 1
            except WebPushException as e:
                code = getattr(e.response, "status_code", None)
                if code in (404, 410):
                    self.removed.append(s["endpoint"])
                    self.subs.remove(s)
                else:
                    self.failed += 1
                    print(f"[push] send failed ({code or type(e).__name__}) for {s['endpoint'][:40]}...")
            except requests.RequestException as e:
                # A dead or unreachable endpoint must not abort the run: the fired columns still get
                # written and the next minute retries the rest.
                self.failed += 1
                print(f"[push] send failed ({type(e).__name__}) for {s['endpoint'][:40]}...")
        if ok:
            return "delivered"
        return "none" if not self.subs else "failed"


def rows(cur, sql, args=()):
    cur.execute(sql, args)
    cols = [d.name for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def run(conn, now, dry=False):
    out = {"reminders": 0, "habits": 0, "tasks": 0, "digest": 0, "events": 0}
    today = now.date()
    with conn.cursor() as cur:
        subs = rows(cur, "select endpoint, p256dh, auth from os_push_subscriptions")
        sender = Sender(subs, dry)
        n_subs = len(subs)

        def done(outcome, due_at, sql, args):
            """Mark one item and commit at once (send -> mark -> commit, per item)."""
            if dry or not should_mark(outcome, now, due_at):
                return
            cur.execute(sql, args)
            conn.commit()

        # reminders
        for r in rows(cur, "select * from os_reminders where active"):
            slot = reminder_due(r, now)
            if not slot:
                continue
            res = sender.send(r["title"], r.get("notes") or "Reminder", f"reminder-{r['id']}", "/#/reminders")
            out["reminders"] += 1
            if r.get("snooze_of"):
                # A snooze copy is one-off: it goes away once it has rung, in the same commit as the bookkeeping.
                done(res, slot, "delete from os_reminders where id=%s and snooze_of is not null", (r["id"],))
            else:
                done(res, slot, "update os_reminders set last_fired_at=%s, active = case when repeat='none' then false else active end where id=%s",
                     (now, r["id"]))

        # habits
        for h in rows(cur, "select * from os_habits where active and time_local is not null"):
            cur.execute("select 1 from os_habit_logs where habit_id=%s and day=%s and done", (h["id"], today))
            act = habit_due(h, now, cur.fetchone() is not None)
            if not act:
                continue
            res = "none"
            if act == "push":
                res = sender.send(h["name"], f"Habit time, {h['time_local']:%H:%M}.", f"habit-{h['id']}", "/#/habits")
                out["habits"] += 1
            done(res, datetime.combine(today, h["time_local"], tzinfo=IST),
                 "update os_habits set last_pushed_on=%s where id=%s", (today, h["id"]))

        # tasks at due_time
        for t in rows(cur, """select id,title,due_date,due_time,pushed_at from os_tasks
                              where status='open' and due_time is not null and due_date is not null and pushed_at is null"""):
            act = task_due(t, now)
            if not act:
                continue
            res = "none"
            if act == "push":
                res = sender.send(t["title"], f"Due {t['due_time']:%H:%M}.", f"task-{t['id']}", "/#/tasks")
                out["tasks"] += 1
            # Guarded (D12): if the user moved the due time since the select, this matches nothing and the
            # new time pushes on its own.
            done(res, datetime.combine(t["due_date"], t["due_time"], tzinfo=IST),
                 """update os_tasks set pushed_at=%s where id=%s and pushed_at is null
                    and due_date=%s and due_time=%s and status='open'""",
                 (now, t["id"], t["due_date"], t["due_time"]))

        # 08:00 digest
        cur.execute("select value from os_settings where key='push_digest_on'")
        row = cur.fetchone()
        if digest_due(now, row[0] if row else None):
            planned = rows(cur, """select id, title, due_time from os_tasks where status='open'
                                   and (planned_for = %s or due_date = %s)""", (today, today))
            cur.execute("select top_task_ids from os_days where day=%s", (today,))
            drow = cur.fetchone()
            claude_ids = [r["task_id"] for r in rows(cur, "select task_id from os_claude_requests where task_id is not null and status = any(%s)",
                                                       (list(CLAUDE_OPEN),))]
            cur.execute("select count(*) from os_tasks where status='open' and due_date < %s", (today,))
            older = cur.fetchone()[0]
            title, body = digest_message(order_planned(planned, drow[0] if drow else []), claude_ids, older, busy_events_today(cur, today))
            res = sender.send(title, body, "digest", "/#/")
            out["digest"] = len(planned)
            done(res, datetime.combine(today, DIGEST_FROM, tzinfo=IST),
                 """insert into os_settings(key,value) values ('push_digest_on',%s::jsonb)
                    on conflict (key) do update set value=excluded.value, updated_at=now()""", (json.dumps(str(today)),))

        # watchdog: campaign numbers stale (once per IST day)
        cur.execute("select value from os_settings where key='push_stale_on'")
        row = cur.fetchone()
        cur.execute("select max(taken_at) from os_campaign_snapshots")
        alert = stale_numbers_alert(cur.fetchone()[0], now, row[0] if row else None)
        if alert:
            res = sender.send(alert[0], alert[1], "stale-numbers", "/#/activity")
            out["stale"] = 1
            done(res, None, """insert into os_settings(key,value) values ('push_stale_on',%s::jsonb)
                               on conflict (key) do update set value=excluded.value, updated_at=now()""", (json.dumps(str(today)),))

        # unread bad events
        seen = set()
        for e in rows(cur, """select id,title,body,source,occurred_at from os_events
                              where severity='bad' and read_at is null and pushed_at is null order by occurred_at desc"""):
            key = (e["source"], e["title"])
            cur.execute("""select 1 from os_events where source is not distinct from %s and title=%s
                           and pushed_at > %s limit 1""", (e["source"], e["title"], now - timedelta(hours=24)))
            if key in seen or cur.fetchone():
                continue
            seen.add(key)
            res = sender.send(e["title"], e.get("body") or "Needs a look.", f"event-{e['id']}", "/#/feed")
            out["events"] += 1
            done(res, e["occurred_at"],
                 "update os_events set pushed_at=%s where source is not distinct from %s and title=%s and read_at is null and pushed_at is null",
                 (now, e["source"], e["title"]))

        if not dry:
            for ep in sender.removed:
                cur.execute("delete from os_push_subscriptions where endpoint=%s", (ep,))
            summary = {"at": now.astimezone(timezone.utc).isoformat(), "subscriptions": n_subs, "sent": sender.sent,
                       "failed": sender.failed, "removed": len(sender.removed), "capped": sender.capped, **out}
            cur.execute("""insert into os_settings(key,value) values ('push_last_run',%s::jsonb)
                           on conflict (key) do update set value=excluded.value, updated_at=now()""", (json.dumps(summary),))
            conn.commit()
        out.update(subscriptions=n_subs, sent=sender.sent, failed=sender.failed, removed=len(sender.removed))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--now")
    a = ap.parse_args()
    url = os.environ.get("SUPABASE_DB_URL")
    if not url:
        sys.exit("SUPABASE_DB_URL is not set.")
    import psycopg
    now = datetime.fromisoformat(a.now).astimezone(IST) if a.now else datetime.now(IST)
    with psycopg.connect(url) as conn:
        print(json.dumps(run(conn, now, a.dry_run)))


if __name__ == "__main__":
    main()
