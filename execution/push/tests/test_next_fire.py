import sys
from datetime import datetime, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "shared"))
from next_fire import IST, next_fire  # noqa: E402


def at(y, m, d, hh=0, mm=0):
    return datetime(y, m, d, hh, mm, tzinfo=IST)


# 2026-10-22 is a Thursday.
def test_none_future_and_past():
    r = at(2026, 10, 25, 9, 0)
    assert next_fire("none", at(2026, 10, 22, 8), remind_at=r) == r
    assert next_fire("none", at(2026, 10, 26), remind_at=r) is None
    assert next_fire("none", r, remind_at=r) is None            # strictly after


def test_daily_same_day_then_next_day():
    assert next_fire("daily", at(2026, 10, 22, 8, 0), time_local=time(8, 30)) == at(2026, 10, 22, 8, 30)
    assert next_fire("daily", at(2026, 10, 22, 8, 30), time_local=time(8, 30)) == at(2026, 10, 23, 8, 30)


def test_weekdays_skips_weekend():
    fri = at(2026, 10, 23, 10, 0)                                # Friday after the time
    assert next_fire("weekdays", fri, time_local=time(9, 0)) == at(2026, 10, 26, 9, 0)   # Monday


def test_weekly_uses_anchor_weekday_by_default():
    anchor = at(2026, 10, 21, 7, 0)                              # a Wednesday (3)
    assert next_fire("weekly", at(2026, 10, 22), remind_at=anchor, time_local=time(7, 0)) == at(2026, 10, 28, 7, 0)


def test_weekly_with_days():
    assert next_fire("weekly", at(2026, 10, 22, 12), time_local=time(9, 0), repeat_days=[1]) == at(2026, 10, 26, 9, 0)


def test_custom_days_and_empty_days_never_fires():
    assert next_fire("custom", at(2026, 10, 22, 12), time_local=time(9, 0), repeat_days=[0, 6]) == at(2026, 10, 24, 9, 0)
    assert next_fire("custom", at(2026, 10, 22), time_local=time(9, 0), repeat_days=[]) is None


def test_not_before_remind_at():
    anchor = at(2026, 11, 2, 10, 0)
    assert next_fire("daily", at(2026, 10, 22), remind_at=anchor, time_local=time(9, 0)) == at(2026, 11, 3, 9, 0)
    assert next_fire("daily", at(2026, 10, 22), remind_at=anchor, time_local=time(11, 0)) == at(2026, 11, 2, 11, 0)


def test_monthly_month_end_clamp():
    anchor = at(2026, 1, 31, 9, 0)
    t = time(9, 0)
    assert next_fire("monthly", at(2026, 1, 31, 9, 0), remind_at=anchor, time_local=t) == at(2026, 2, 28, 9, 0)
    assert next_fire("monthly", at(2026, 2, 28, 9, 0), remind_at=anchor, time_local=t) == at(2026, 3, 31, 9, 0)
    assert next_fire("monthly", at(2027, 12, 31, 9, 0), remind_at=anchor, time_local=t) == at(2028, 1, 31, 9, 0)
    assert next_fire("monthly", at(2028, 1, 31, 9, 0), remind_at=anchor, time_local=t) == at(2028, 2, 29, 9, 0)  # leap year
    assert next_fire("monthly", at(2026, 3, 31, 9, 0), remind_at=anchor, time_local=t) == at(2026, 4, 30, 9, 0)


def test_repeat_without_time_never_fires():
    assert next_fire("daily", at(2026, 10, 22), time_local=None) is None


def test_utc_input_is_converted_to_ist():
    from datetime import timezone
    after = datetime(2026, 10, 22, 2, 30, tzinfo=timezone.utc)   # 08:00 IST
    assert next_fire("daily", after, time_local=time(8, 30)) == at(2026, 10, 22, 8, 30)
