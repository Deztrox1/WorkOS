#!/usr/bin/env python3
"""
watchdog: the cloud job checks the VPS reminder sender and calendar link, and reports its own failure (QA r1 I01, r4 R4B04).

  watchdog.py check                      exit 1 when os_settings.push_last_run.at is older than 10 min or missing, or the
                                         calendar is linked and its unit last wrote over 30 min ago, or its last good check
                                         is over 6 hours old. Prints only the times. GitHub then emails the owner.
  watchdog.py failed "<step>, <step>"    write ONE os_events row (bad, "The cloud check failed") naming the steps.
                                         Never fails the job: if it cannot connect it says so and exits 0.
Env: SUPABASE_DB_URL.
"""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
MAX_AGE = timedelta(minutes=10)
CALENDAR_MAX_AGE = timedelta(minutes=30)     # the unit writes os_calendar_state every 2 minutes, good run or not
CALENDAR_MAX_BAD = timedelta(hours=6)        # the unit runs, but no run has been good for this long


def sender_stale(at_iso, now):
    """True when the sender has not stamped push_last_run within MAX_AGE (or never)."""
    if not at_iso:
        return True
    try:
        at = datetime.fromisoformat(at_iso)
    except ValueError:
        return True
    if at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    return now - at > MAX_AGE


def calendar_stale(linked, last_ok_at, updated_at, now):
    """True when the calendar is linked and its unit stopped (updated_at), or no run has been good for CALENDAR_MAX_BAD.
    last_ok_at also stops when only the owner can fix it, and the app says so at once, so it gets the longer limit: the
    hourly job must not stay red over that and hide a real collector failure. Not linked: nothing to watch."""
    if not linked:
        return False
    if updated_at is None or now - updated_at > CALENDAR_MAX_AGE:
        return True
    return last_ok_at is None or now - last_ok_at > CALENDAR_MAX_BAD


def failed_event(steps):
    return ("The cloud check failed", f"These steps failed: {steps}. Open the hourly run on GitHub to see why.")


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    from _common import IST, add_event, connect
    if cmd == "check":
        with connect() as conn, conn.cursor() as cur:
            cur.execute("select value->>'at' from os_settings where key='push_last_run'")
            row = cur.fetchone()
            cur.execute("select to_regclass('public.os_calendar_state')")     # this job can land before migration 0010
            calendar = None
            if cur.fetchone()[0]:
                cur.execute("select linked, last_ok_at, updated_at from os_calendar_state where id")
                calendar = cur.fetchone()
        at = row[0] if row else None
        shown = datetime.fromisoformat(at).astimezone(IST).strftime("%H:%M, %d %b") if at else "never"
        print(f"reminder sender last ran at {shown}")
        now = datetime.now(timezone.utc)
        linked, last_ok, wrote = calendar or (False, None, None)
        if linked:
            when = lambda t: t.astimezone(IST).strftime("%H:%M, %d %b") if t else "never"    # noqa: E731
            print(f"calendar last checked at {when(last_ok)}, last ran at {when(wrote)}")
        return 1 if sender_stale(at, now) or calendar_stale(linked, last_ok, wrote, now) else 0
    if cmd == "failed":
        steps = sys.argv[2] if len(sys.argv) > 2 else "unknown"
        title, body = failed_event(steps)
        try:
            with connect() as conn, conn.cursor() as cur:
                add_event(cur, "system", title, body, "bad", "collect_workflow")
                conn.commit()
        except BaseException as e:  # noqa: BLE001  (connect() exits with SystemExit when the URL is missing)
            print(f"watchdog: could not write the event ({type(e).__name__})")
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
