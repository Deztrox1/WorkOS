#!/usr/bin/env python3
"""
Seed WorkOS v1 finance costs (PRD 5.9) and settings. Idempotent: costs match on (source='seed',
source_ref=slug; insert-only, so an amount or month the owner edited is never reverted); settings use insert ... on conflict do nothing (a hand-edited value is never reset).
Never deletes. The two personal reminders come from seed_initial.py and stay.

    python3 seed_v1.py
"""
import json, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import apply  # noqa: E402
import psycopg  # noqa: E402

# slug, label, amount, currency, start month, notes
COSTS = [
    ("anthropic", "Anthropic", 100, "USD", "2026-10-01", "Claude plan"),
    ("instantly", "Instantly", 100, "USD", "2026-10-01", "Starts Oct 2026"),
    ("winnr", "Winnr", 50, "USD", "2026-10-01", "Sending inboxes"),
    ("gosimless", "GoSimless", 15, "USD", "2026-10-01", "About 15 USD"),
    ("google-workspace", "Google Workspace", 3, "USD", "2026-10-01", None),
]
SETTINGS = {"profit_target": 1000, "fx": {"USD": 1, "INR": 0.0119, "GBP": 1.3}}


def main():
    c = {"costs_inserted": 0, "costs_existing": 0, "settings_inserted": 0, "settings_existing": 0}
    with psycopg.connect(apply.db_url()) as conn, conn.cursor() as cur:
        for slug, label, amt, cur_, month, notes in COSTS:
            cur.execute("""insert into os_finance_entries(kind,label,amount,currency,recurrence,month,source,source_ref,notes)
                           values ('cost',%s,%s,%s,'monthly',%s,'seed',%s,%s)
                           on conflict (source, source_ref) where source_ref is not null do nothing""",
                        (label, amt, cur_, month, slug, notes))
            c["costs_inserted" if cur.rowcount else "costs_existing"] += 1
        for k, v in SETTINGS.items():
            cur.execute("insert into os_settings(key,value) values (%s,%s::jsonb) on conflict (key) do nothing",
                        (k, json.dumps(v)))
            c["settings_inserted" if cur.rowcount else "settings_existing"] += 1
        cur.execute("select count(*) from os_reminders"); c["reminders_total"] = cur.fetchone()[0]
        conn.commit()
    print(json.dumps(c))


if __name__ == "__main__":
    main()
