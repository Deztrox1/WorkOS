"""Plain-words event titles written by the collectors (QA r3 C04, C06). Pure: no network, no database."""
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
pytest.importorskip("config", reason="needs the Cold Email clients on the path")
import campaign_pulse as cp  # noqa: E402

BAD = re.compile(r"->|\+\d|/ status|\bSTOP\b|ghl-|\d{4}-\d{2}-\d{2}|\bstatus\b")


def test_campaign_events_read_in_plain_words():
    prev = ("active", 4, 1, 1, 100)
    r = dict(campaign_name="HVAC wave 4", account="ghl-primary", status="paused", replies_total=7, positives_total=2,
             bounces_total=9, sent_total=100)
    ev = cp.diff_events(prev, r, True)
    titles = [t for t, _, _ in ev]
    assert titles == ["HVAC wave 4 is now paused", "HVAC wave 4: 3 new replies", "HVAC wave 4: 1 new positive reply", "HVAC wave 4: bounces up 8.0 points"]
    assert ev[0][1] == "GHL main" and ev[3][1] == "9 of 100 sent bounced"
    for t, b, _ in ev:
        assert not BAD.search(t) and not BAD.search(b or "")


def test_new_campaign_body_uses_account_and_status_words():
    r = dict(campaign_name="N", account="ghl-brightpath", status="active")
    assert cp.diff_events(None, r, True) == [("New campaign: N", "GHL Brightpath, live", "info")]
