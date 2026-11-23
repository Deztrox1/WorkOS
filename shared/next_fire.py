"""
Reminder next-fire rules (PRD 5.5). The app ports this file to shared/nextFire.ts; keep it small.

    next_fire(repeat, after, remind_at=None, time_local=None, repeat_days=None) -> datetime | None

Returns the first fire time STRICTLY AFTER `after` and not before `remind_at` (when set), in IST, or
None when the reminder can never fire (one-off already past, repeat without a time, custom without days).
`time_local` is an IST wall-clock time (datetime.time); when missing it falls back to the IST time of `remind_at`. Weekdays are 0=Sun .. 6=Sat (the DB convention;
Python's weekday() is Mon=0, so we convert).

  none      remind_at itself
  daily     every day at time_local
  weekdays  Mon to Fri at time_local
  weekly    repeat_days (default: the IST weekday of remind_at) at time_local
  custom    repeat_days at time_local
  monthly   the IST day-of-month of remind_at at time_local, clamped to the month's last day
            (31st -> 30th or 28th/29th). remind_at is the anchor and is never rewritten.
"""
from calendar import monthrange
from datetime import date, datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30), "IST")


def _db_weekday(d: date) -> int:
    return (d.weekday() + 1) % 7          # Mon=0 -> 1 ... Sun=6 -> 0


def next_fire(repeat, after, remind_at=None, time_local=None, repeat_days=None):
    after = after.astimezone(IST)
    anchor = remind_at.astimezone(IST) if remind_at else None
    if repeat == "none":
        return anchor if anchor and anchor > after else None
    if time_local is None and anchor is not None:
        time_local = anchor.timetz().replace(tzinfo=None)   # same fallback as the TS port: the wall time of remind_at
    if time_local is None:
        return None
    days = set(repeat_days or [])
    if repeat == "weekly" and not days and anchor:
        days = {_db_weekday(anchor.date())}
    if repeat == "custom" and not days:
        return None
    if repeat == "weekly" and not days:
        return None
    if repeat not in ("daily", "weekdays", "weekly", "custom", "monthly"):
        return None
    start = max(after.date(), anchor.date()) if anchor else after.date()
    for i in range(0, 400):
        d = start + timedelta(days=i)
        if repeat == "weekdays" and _db_weekday(d) not in (1, 2, 3, 4, 5):
            continue
        if repeat in ("weekly", "custom") and _db_weekday(d) not in days:
            continue
        if repeat == "monthly":
            if not anchor:
                return None
            if d.day != min(anchor.day, monthrange(d.year, d.month)[1]):
                continue
        t = datetime.combine(d, time_local, tzinfo=IST)
        if t > after and (anchor is None or t >= anchor):
            return t
    return None
