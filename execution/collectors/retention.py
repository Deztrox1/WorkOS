#!/usr/bin/env python3
"""
retention: keep the two growing tables bounded (QA r1 D8, D19). Run hourly by workos-collect.yml after
campaign_pulse; safe to run any time, any number of times (idempotent).

  os_campaign_snapshots  rows from the last 14 IST days stay hourly. Older days keep ONE row per
                         (account, campaign_id, IST day): the last snapshot of that day, which is exactly the
                         row os_campaign_daily shows. The latest row of every campaign is always kept, so
                         os_campaigns_latest is unchanged. A row whose raw is a FULL object (not the
                         same_as_previous marker) is never deleted, so the only full copy of a campaign
                         survives (QA r2 D10).
  os_events              read events older than 180 days are deleted. Unread events are never deleted.

Each run deletes at most BATCH rows per table (the first run on a big table catches up over a few hours).
Lives here and not in a migration because the migration guard refuses DELETE in migration files.
Env: SUPABASE_DB_URL. Flags: --dry-run (count only).
"""
import argparse
import json
import sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import ist_today  # noqa: E402

HOURLY_DAYS = 14
EVENT_DAYS = 180
BATCH = 20_000

SNAP_EXTRA = """
select id from (
  select id, row_number() over (
           partition by account, campaign_id, (taken_at at time zone 'Asia/Kolkata')::date
           order by taken_at desc, id desc) as rn
    from os_campaign_snapshots
   where (taken_at at time zone 'Asia/Kolkata')::date < %(cut)s
) x where rn > 1
  and not exists (select 1 from os_campaign_snapshots f where f.id = x.id and f.raw is not null
                  and coalesce(f.raw->>'same_as_previous', '') <> 'true')
limit %(batch)s
"""
OLD_EVENTS = """
select id from os_events where read_at is not null and occurred_at < now() - make_interval(days => %(days)s)
limit %(batch)s
"""


def prune(cur, dry=False, today=None):
    """Returns {"snapshots": n, "events": n} (rows deleted, or that would be in a dry run). Caller commits."""
    cut = (today or ist_today()) - timedelta(days=HOURLY_DAYS)
    out = {}
    for name, table, sql, args in (
        ("snapshots", "os_campaign_snapshots", SNAP_EXTRA, {"cut": cut, "batch": BATCH}),
        ("events", "os_events", OLD_EVENTS, {"days": EVENT_DAYS, "batch": BATCH}),
    ):
        if dry:
            cur.execute(f"select count(*) from ({sql}) q", args)
            out[name] = cur.fetchone()[0]
        else:
            cur.execute(f"delete from {table} where id in ({sql})", args)
            out[name] = cur.rowcount
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    from _common import connect, load_env
    load_env()
    with connect() as conn, conn.cursor() as cur:
        out = prune(cur, a.dry_run)
        if a.dry_run:
            conn.rollback()
        else:
            conn.commit()
    print(json.dumps({"retention": out, "dry_run": a.dry_run}))


if __name__ == "__main__":
    main()
