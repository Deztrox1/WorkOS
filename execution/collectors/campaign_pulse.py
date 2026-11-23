#!/usr/bin/env python3
"""
campaign_pulse: snapshot every Instantly campaign and every GHL SMS workflow into
os_campaign_snapshots, then write os_events when something changed since the last snapshot.

READ ONLY toward Instantly and GHL (GET calls only). Writes only to our Supabase tables.
Reuses WF - Cold Email/execution/daily_campaign_summary/instantly_client.py (its GET helper)
and execution/ghl/client.py (GHLClient, reads accounts.json); no API calls are re-implemented.

Email (account 'instantly'): campaign list from GET /campaigns, totals from GET
/campaigns/analytics (all campaigns, any status): emails_sent_count, reply_count_unique,
bounced_count, open_count, leads_count. positives_total = total_opportunities (Instantly's
count of leads marked as opportunities, the closest "positive" the API exposes).

SMS (accounts 'ghl-primary', 'ghl-brightpath'): GHL has no /campaigns, only /workflows, so
each workflow is one row with its status (draft/published). GHL exposes NO per-workflow sent or
reply counts, so those columns are NULL for SMS; only status changes raise events.
(Account-level SMS volume is already in the daily summary email.)

Events (kind 'campaign'), only when something changed vs the previous snapshot:
  replies up           -> good   | positives up -> good
  bounce rate up >= 3 percentage points -> bad
  status changed       -> info  | brand-new campaign (once an account has history) -> info
First run only records a baseline (no events).

Also (PRD section 4):
  SMS days     once a day, first run after 02:00 IST, per GHL account: yesterday's IST window through the
               daily-summary client + classifier -> os_sms_days (sent, replies = unique people, positives,
               negatives, stops, capped). STOP = inbound body matching STOP_RE, counted here. `bad` event when
               stops / sent > 5% and sent >= 20.
  Playbook     raw.playbook_status on each snapshot = the Status in the matching campaign README of the
               cold-outreach playbook (matched by campaign id in the README, else slug == slugified name).
Env: OPENROUTER_API_KEY (classifier; heuristic fallback without it), INSTANTLY_API_KEY, GHL_API_KEY, GHL_LOCATION_ID, GHL_BRIGHTPATH_API_KEY,
GHL_BRIGHTPATH_LOCATION_ID, SUPABASE_DB_URL. Locally loaded from WF - Cold Email/.env.
An account without credentials is skipped with a note, never a crash.
"""
import json
import re
import sys
from datetime import datetime, time as dtime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import COLD_EMAIL, add_event, connect, ist_now, load_env, slim_raw  # noqa: E402

load_env()  # must run BEFORE importing config (reads env at import time)
SUMMARY = COLD_EMAIL / "execution" / "daily_campaign_summary"
for p in (SUMMARY, COLD_EMAIL / "execution"):
    sys.path.insert(0, str(p))

import instantly_client as ic  # noqa: E402
from config import INSTANTLY_API_KEY  # noqa: E402

INSTANTLY_STATUS = {0: "draft", 1: "active", 2: "paused", 3: "completed", 4: "subsequences",
                    -1: "accounts_unhealthy", -2: "bounce_protect", -99: "suspended"}
SOURCE = "campaign_pulse"


def instantly_rows():
    if not INSTANTLY_API_KEY:
        print("[pulse] INSTANTLY_API_KEY missing, skipping Instantly")
        return []
    camps, params = [], {"limit": 100}
    for _ in range(20):
        d = ic._get("/campaigns", params)
        items = ic._items(d)
        camps += items
        nxt = d.get("next_starting_after") if isinstance(d, dict) else None
        if not nxt or len(items) < 100:
            break
        params["starting_after"] = nxt
    ana = {a.get("campaign_id"): a for a in (ic._items(ic._get("/campaigns/analytics", {})) or [])}
    rows = []
    for c in camps:
        a = ana.get(c["id"], {})
        rows.append(dict(channel="email", account="instantly", campaign_id=c["id"],
                         campaign_name=c.get("name") or c["id"],
                         status=INSTANTLY_STATUS.get(c.get("status"), str(c.get("status"))),
                         sent_total=a.get("emails_sent_count"), replies_total=a.get("reply_count_unique"),
                         positives_total=a.get("total_opportunities"), bounces_total=a.get("bounced_count"),
                         opens_total=a.get("open_count"), leads_total=a.get("leads_count"),
                         raw={"campaign": c, "analytics": a}))
    return rows


def ghl_rows():
    from ghl.client import GHLClient
    rows = []
    for slug, label in (("primary", "ghl-primary"), ("brightpath", "ghl-brightpath")):
        try:
            cl = GHLClient(slug)
        except Exception as e:  # noqa: BLE001
            print(f"[pulse] GHL {slug}: {e}")
            continue
        if not cl.configured:
            print(f"[pulse] GHL {slug}: no credentials, skipping")
            continue
        data = cl.get("/workflows/", {"locationId": cl.location_id}) or {}
        for w in data.get("workflows", []):
            rows.append(dict(channel="sms", account=label, campaign_id=w["id"],
                             campaign_name=w.get("name") or w["id"], status=w.get("status"),
                             sent_total=None, replies_total=None, positives_total=None,
                             bounces_total=None, opens_total=None, leads_total=None, raw=w))
    return rows


# ------------------------------------------------------------------ playbook status
PLAYBOOK = COLD_EMAIL / "cold-outreach-playbook"
_STATUS_ALIAS = {"live": "active", "running": "active", "published": "active", "in": "active"}


def _slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")


def playbook_index():
    """[(slug, readme_text, normalised status)] for every campaign README in the playbook checkout."""
    out = []
    for p in sorted(PLAYBOOK.glob("*/campaigns/*/README.md")):
        text = p.read_text(errors="ignore")
        m = re.search(r"^\|\s*Status\s*\|\s*(.+?)\s*\|?\s*$", text, re.M)
        if not m:
            continue
        w = re.search(r"[A-Za-z][A-Za-z-]*", m.group(1).replace("*", ""))
        if not w:
            continue
        st = w.group(0).lower()
        out.append((p.parent.name, text, _STATUS_ALIAS.get(st, st), p.parts[-4]))
    return out


_GENERIC = {"2026", "email", "sms", "campaign"}


def playbook_status(index, r):
    """Match order: campaign id inside a README; slug == slugified name; else every non-generic slug
    token appears in the squashed campaign name, same channel, and exactly one README qualifies."""
    for slug, text, st, _ in index:
        if r["campaign_id"] in text:
            return st
    want = _slugify(r["campaign_name"])
    for slug, _, st, _ in index:
        if slug == want:
            return st
    squashed = re.sub(r"[^a-z0-9]", "", r["campaign_name"].lower())
    hits = []
    for slug, _, st, chan in index:
        if chan != r["channel"]:
            continue
        toks = [t for t in slug.split("-") if t not in _GENERIC]
        if toks and all(t in squashed for t in toks):
            hits.append(st)
    return hits[0] if len(hits) == 1 else None


# ------------------------------------------------------------------ SMS days
STOP_RE = re.compile(r"^\s*(stop|unsubscribe|cancel|end|quit)\b", re.I)


ACCOUNT_WORDS = {"ghl-primary": "GHL main", "ghl-brightpath": "GHL Brightpath"}
STATUS_WORDS = {"active": "live", "paused": "paused", "completed": "finished", "draft": "draft"}


def account_word(a):
    """An account as the app says it: 'ghl-primary' reads 'GHL main'. The stored account value never changes."""
    return ACCOUNT_WORDS.get(a, str(a).replace("-", " ").title())


def status_word(s):
    return STATUS_WORDS.get(str(s).lower(), str(s))


def plural(n, one, many):
    return f"{n} {one if n == 1 else many}"


def sms_days(cur):
    """Fill yesterday's os_sms_days row for every GHL account that has none yet. Returns a summary dict."""
    now = ist_now()
    if now.hour < 2:
        return {"skipped": "before 02:00 IST"}
    day = now.date() - timedelta(days=1)
    start = datetime.combine(day, dtime(0, 0), tzinfo=now.tzinfo).astimezone(timezone.utc)
    end = start + timedelta(days=1)
    cur.execute("select account from os_sms_days where day=%s", (day,))
    have = {r[0] for r in cur.fetchall()}
    want = [(s, l) for s, l in (("primary", "ghl-primary"), ("brightpath", "ghl-brightpath")) if l not in have]
    if not want:
        return {"skipped": f"{day} already recorded"}
    import ghl_client as gc
    from classifier import classify_replies
    res = gc.fetch_sms_activity_by_account(start, end, accounts=[s for s, _ in want])
    out = {"day": str(day)}
    for slug, label in want:
        r = res.get(slug)
        if not r or r.get("skipped"):
            out[label] = "no credentials"
            continue
        people = {}
        for x in r["replies"]:                       # one reply per person, their latest message
            if x["key"] not in people or x["ts"] > people[x["key"]]["ts"]:
                people[x["key"]] = x
        people = sorted(people.values(), key=lambda x: x["ts"])
        labels = classify_replies(people)
        stops = len({x["key"] for x in r["replies"] if STOP_RE.match(x["text"] or "")})
        pos, neg = labels.count("positive"), labels.count("negative")
        cur.execute("""insert into os_sms_days(day,account,sent,replies,positives,negatives,stops,capped)
                       values (%s,%s,%s,%s,%s,%s,%s,%s)
                       on conflict (day,account) do update set sent=excluded.sent, replies=excluded.replies,
                       positives=excluded.positives, negatives=excluded.negatives, stops=excluded.stops,
                       capped=excluded.capped""",
                    (day, label, r["sent"], len(people), pos, neg, stops, bool(r.get("capped"))))
        out[label] = dict(sent=r["sent"], replies=len(people), positives=pos, negatives=neg, stops=stops,
                          capped=bool(r.get("capped")))
        if r["sent"] >= 20 and stops / r["sent"] > 0.05:
            add_event(cur, "alert", f"{account_word(label)}: {plural(stops, 'person', 'people')} said stop on {day.day} {day:%b} ({stops / r['sent'] * 100:.1f}% of {r['sent']} sent)",
                      "Opt-out rate above 5%. Check the message and the list.", "bad", SOURCE)
    return out


def diff_events(prev, r, has_history):
    """Return [(title, body, severity)] for one campaign vs its previous snapshot."""
    n = r["campaign_name"]
    if prev is None:
        return [(f"New campaign: {n}", f"{account_word(r['account'])}, {status_word(r['status'])}", "info")] if has_history else []
    out = []
    pst, pre, ppo, pbo, pse = prev
    if r["status"] != pst:
        out.append((f"{n} is now {status_word(r['status'])}", account_word(r["account"]), "info"))
    if r["replies_total"] is not None and pre is not None and r["replies_total"] > pre:
        k = r["replies_total"] - pre
        out.append((f"{n}: {k} new {'reply' if k == 1 else 'replies'}", f"{r['replies_total']} in all", "good"))
    if r["positives_total"] is not None and ppo is not None and r["positives_total"] > ppo:
        k = r["positives_total"] - ppo
        out.append((f"{n}: {k} new positive {'reply' if k == 1 else 'replies'}", f"{r['positives_total']} in all", "good"))
    if r["bounces_total"] is not None and r["sent_total"] and pse and pbo is not None:
        d = r["bounces_total"] / r["sent_total"] - pbo / pse
        if d >= 0.03:
            out.append((f"{n}: bounces up {d*100:.1f} points",
                        f"{r['bounces_total']} of {r['sent_total']} sent bounced", "bad"))
    return out


def main():
    rows = instantly_rows() + ghl_rows()
    pidx = playbook_index()
    for r in rows:
        ps = playbook_status(pidx, r)
        if ps:
            if not isinstance(r["raw"], dict):
                r["raw"] = {"value": r["raw"]}
            r["raw"]["playbook_status"] = ps
    now = datetime.now(timezone.utc)
    events = 0
    with connect() as conn, conn.cursor() as cur:
        cur.execute("select distinct account from os_campaign_snapshots")
        history = {r[0] for r in cur.fetchall()}
        for r in rows:
            cur.execute("""select status, replies_total, positives_total, bounces_total, sent_total, raw->>'hash'
                           from os_campaign_snapshots where account=%s and campaign_id=%s
                           order by taken_at desc limit 1""", (r["account"], r["campaign_id"]))
            got = cur.fetchone()
            prev, prev_hash = (got[:5], got[5]) if got else (None, None)
            r["raw"] = slim_raw(r["raw"], prev_hash)
            for title, body, sev in diff_events(prev, r, r["account"] in history):
                cur.execute("""insert into os_events(kind,title,body,severity,area,source,occurred_at)
                               values ('campaign',%s,%s,%s,'work',%s,%s)""", (title, body, sev, SOURCE, now))
                events += 1
            cur.execute("""insert into os_campaign_snapshots(taken_at,channel,account,campaign_id,campaign_name,
                           status,sent_total,replies_total,positives_total,bounces_total,opens_total,leads_total,raw)
                           values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                        (now, r["channel"], r["account"], r["campaign_id"], r["campaign_name"], r["status"],
                         r["sent_total"], r["replies_total"], r["positives_total"], r["bounces_total"],
                         r["opens_total"], r["leads_total"], json.dumps(r["raw"], default=str)))
        conn.commit()
        try:
            sms = sms_days(cur)
            conn.commit()
        except Exception as e:  # noqa: BLE001  (never lose the snapshots over the SMS day)
            conn.rollback()
            # Type only: the run log is visible to anyone with repo access, and messages can carry
            # URLs or keys (QA r1 Q13).
            sms = {"error": type(e).__name__}
    by = {}
    for r in rows:
        by[r["account"]] = by.get(r["account"], 0) + 1
    print(json.dumps({"campaigns": len(rows), "snapshots": len(rows), "events": events, "by_account": by,
                      "playbook_matched": sum(1 for r in rows if isinstance(r["raw"], dict) and "playbook_status" in r["raw"]),
                      "sms_days": sms}))


if __name__ == "__main__":
    main()
