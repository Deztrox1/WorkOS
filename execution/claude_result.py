#!/usr/bin/env python3
"""
claude_result: the write-back half of the Claude queue. A Claude Code session (routine or laptop) runs this
when it finishes a WorkOS request, so the app shows the outcome.

  python3 execution/claude_result.py --id <request uuid> --status done --result "what was done, one paragraph"
  python3 execution/claude_result.py --id <request uuid> --status failed --error "why"
  python3 execution/claude_result.py --list            # queued and sent requests, newest first

Reads SUPABASE_DB_URL from the environment or WF - WorkOS/.env. If the variable is missing it prints a
one-line notice and exits 0, so a routine without database access still ends cleanly. The URL must name the
WorkOS project (WORKOS_PROJECT_REF, default yourprojectref), or nothing is written.

Guarded (QA r1 Q10): it only finishes a request that is in flight (status firing or sent). A request the
owner cancelled, or one already done or failed, is left alone. It never queues anything.
"""
import argparse
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECT_REF = os.environ.get("WORKOS_PROJECT_REF", "yourprojectref")


def db_url() -> str | None:
    if os.environ.get("SUPABASE_DB_URL"):
        return os.environ["SUPABASE_DB_URL"]
    env = HERE.parent / ".env"
    if env.is_file():
        for line in env.read_text().splitlines():
            if line.startswith("SUPABASE_DB_URL="):
                return line.split("=", 1)[1].strip().strip("'\"")
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--id")
    ap.add_argument("--status", choices=["done", "failed"])
    ap.add_argument("--result")
    ap.add_argument("--error")
    ap.add_argument("--list", action="store_true")
    a = ap.parse_args()
    url = db_url()
    if not url:
        print("claude_result: SUPABASE_DB_URL is not set; nothing written. Mark the request done in the app.")
        return 0
    if PROJECT_REF not in re.sub(r"://([^:/]+):([^@]+)@", r"://\1:***@", url):
        print(f"claude_result: SUPABASE_DB_URL does not name project {PROJECT_REF}; nothing written.", file=sys.stderr)
        return 1
    import psycopg
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        if a.list:
            cur.execute("select id, status, title, created_at from os_claude_requests where status in ('queued','firing','sent') order by created_at desc")
            for r in cur.fetchall():
                print(f"{r[0]}  {r[1]:7}  {r[3]:%Y-%m-%d %H:%M}  {r[2]}")
            return 0
        if not a.id or not a.status:
            ap.error("--id and --status are required")
        # Migration 0008 only lets a firing row move to sent or failed, and only a sent row to done, so a row
        # still marked firing (the result arrived before the poller wrote its 'sent') takes the step through sent.
        if a.status == "done":
            cur.execute("update os_claude_requests set status='sent', sent_at=coalesce(sent_at, now()) where id=%s::uuid and status='firing'", (a.id,))
        cur.execute(
            """update os_claude_requests set status=%s, result=coalesce(%s, result), error=%s, finished_at=now(),
                      sent_at=coalesce(sent_at, now())
               where id=%s::uuid and status in ('firing','sent')""",
            (a.status, a.result, a.error, a.id),
        )
        if cur.rowcount == 0:
            print(f"claude_result: no in-flight request with id {a.id} (unknown, cancelled or already finished); nothing written",
                  file=sys.stderr)
            return 1
        conn.commit()
        print(f"claude_result: {a.id} -> {a.status}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
