"""Shared helpers for WorkOS collectors: env loading, workspace paths, DB connect, raw slimming."""
import hashlib
import json
import os
import sys
from pathlib import Path

WORKSPACE = Path(__file__).resolve().parents[3]          # .../Agentic Workflows (local layout)
# In GitHub Actions the Cold Email repo is checked out elsewhere; COLD_EMAIL_DIR points at it.
COLD_EMAIL = Path(os.environ.get("COLD_EMAIL_DIR") or (WORKSPACE / "WF - Cold Email"))


def load_env():
    """Local runs: fill missing vars from WF - Cold Email/.env. Never overrides, never prints."""
    # WorkOS's own .env wins (its Supabase project); Cold Email's .env fills the vendor keys.
    for p in (WORKSPACE / "WF - WorkOS" / ".env", COLD_EMAIL / ".env"):
        if p.is_file():
            _load_file(p)


def _load_file(p):
    for line in p.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip("'\""))


PROJECT_REF = os.environ.get("WORKOS_PROJECT_REF", "yourprojectref")


def connect():
    """Connect to the WorkOS database only. load_env() fills missing vars from Cold Email's .env, whose
    SUPABASE_DB_URL is a DIFFERENT project (the Outreach DB), so a URL that does not name our project ref is
    refused before anything is written (QA r1 Q12)."""
    import psycopg
    import re
    url = os.environ.get("SUPABASE_DB_URL")
    if not url:
        sys.exit("SUPABASE_DB_URL is not set. Nothing written.")
    if PROJECT_REF not in re.sub(r"://([^:/]+):([^@]+)@", r"://\1:***@", url):
        sys.exit(f"SUPABASE_DB_URL does not name project {PROJECT_REF} (set WORKOS_PROJECT_REF to override). Nothing written.")
    return psycopg.connect(url)


# ---------------------------------------------------------------- time + events
from datetime import datetime, timedelta, timezone  # noqa: E402

IST = timezone(timedelta(hours=5, minutes=30), "IST")   # Asia/Kolkata, no DST


def ist_now():
    return datetime.now(IST)


def ist_today():
    """'Today' for WorkOS is the Asia/Kolkata date, never the machine's."""
    return ist_now().date()


def add_event(cur, kind, title, body, severity, source, area="work", url=None):
    """Insert an os_events row unless one with the same (source, title) already exists on this IST date.
    Returns True when a row was written."""
    # A range on occurred_at (not an expression on it) so os_events_source_title_idx is used (QA r1 D19).
    start = datetime.combine(ist_today(), datetime.min.time(), tzinfo=IST)
    cur.execute("""select 1 from os_events where source=%s and title=%s
                   and occurred_at >= %s and occurred_at < %s limit 1""",
                (source, title, start, start + timedelta(days=1)))
    if cur.fetchone():
        return False
    cur.execute("""insert into os_events(kind,title,body,severity,area,source,url)
                   values (%s,%s,%s,%s,%s,%s,%s)""", (kind, title, body, severity, area, source, url))
    return True


# ------------------------------------------------------------------ raw slimming (QA r1 D8)
KEEP_KEYS = ("playbook_status", "location_id")   # the only raw keys the app reads (app/src/lib/store.ts)


def raw_hash(raw) -> str:
    """Hash of the source object, without the counters (they live in their own columns) and without the
    keys this script adds."""
    body = raw if isinstance(raw, dict) else {"value": raw}
    if "campaign" in body:                        # Instantly: {"campaign": c, "analytics": a}
        body = body["campaign"]
    body = {k: v for k, v in body.items() if k not in KEEP_KEYS + ("hash",)} if isinstance(body, dict) else body
    return hashlib.sha256(json.dumps(body, sort_keys=True, default=str).encode()).hexdigest()[:16]


def slim_raw(raw, prev_hash):
    """Full raw only when the source object changed since the last stored snapshot; otherwise just the
    keys the app reads plus the hash. Cuts ~1,000 full objects a day to the few that changed."""
    full = raw if isinstance(raw, dict) else {"value": raw}
    h = raw_hash(full)
    keep = {k: full[k] for k in KEEP_KEYS if full.get(k) is not None}
    if prev_hash == h:
        return {**keep, "hash": h, "same_as_previous": True}
    return {**full, "hash": h}
