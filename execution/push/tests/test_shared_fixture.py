"""Runs shared/next_fire_cases.json (the same file app/src/shared/nextFire.test.ts reads)."""
import json
import sys
from datetime import datetime, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "shared"))
from next_fire import next_fire  # noqa: E402

CASES = json.loads((ROOT / "shared" / "next_fire_cases.json").read_text())["cases"]


def _t(s):
    return time.fromisoformat(s) if s else None


def test_fixture_cases():
    for c in CASES:
        r = c["reminder"]
        got = next_fire(r["repeat"], datetime.fromisoformat(c["now"]),
                        datetime.fromisoformat(r["remind_at"]) if r.get("remind_at") else None,
                        _t(r.get("time_local")), r.get("repeat_days"))
        exp = datetime.fromisoformat(c["expected"]) if c["expected"] else None
        assert (got == exp) if exp else got is None, c["name"]
