#!/usr/bin/env python3
"""
ops_heartbeat: cheap health checks, written to os_events (kind 'system') only when a check's
state changed since the previous heartbeat. Last state lives in os_settings key 'heartbeat_state'.

Checks (a check whose source is unavailable records state 'unavailable', which raises one warn
event when it starts and one when it recovers; never a silent skip):
  modal      the 4 scheduled Modal crons are 'deployed'   (needs the `modal` CLI + login; local only)
  github     latest GitHub Actions run conclusion         (needs authenticated `gh`; usually skipped)
  domains    date of newest row in WF - Cold Email/logs/domain_health/history.csv (warn if > 40 days)
  invoice    newest Northwind period in WF - DOOH/execution/invoicing/ledger.json (warn if older
             than last month)
  balances   (once a day per vendor, PRD section 4) written to os_settings.balances.<vendor> =
             {value, limit, taken_at, unit}. MillionVerifier /credits, numlookup /v1/status (free, returns the
             plan total, so its limit is automatic), consulti via execution/consulti_client.py credits(),
             AnyMailFinder /v5.1/account (credits_left, no plan total). `limit` for the others is hand-set in
             os_settings.balance_limits {vendor: number}; a vendor without one shows "no total" and never
             alerts. Under 10% of limit raises one `alert` event per (source, title, IST date).
Reads only. Env: SUPABASE_DB_URL, MILLIONVERIFIER_API_KEY, NUM_LOOKUP_API_KEY, CONSULTI_API_KEY,
ANYMAIL_FINDER_API_KEY (a vendor whose key is missing is skipped, keeping its last value).
"""
import csv
import json
import os
import shutil
import subprocess
import sys
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import COLD_EMAIL, IST, WORKSPACE, add_event, connect, ist_today, load_env  # noqa: E402

load_env()
SOURCE = "ops_heartbeat"
CRONS = ["cold-creds-sentinel", "cold-daily-summary", "cold-weekly-logbook", "cold-winnr-reminder"]


def _run(cmd, timeout=60):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout
    except Exception:  # noqa: BLE001
        return 1, ""


def check_modal():
    if not shutil.which("modal"):
        return None
    rc, out = _run(["modal", "app", "list", "--json"])
    if rc != 0:
        return None
    try:
        apps = {a["Description"]: a["State"] for a in json.loads(out)}
    except Exception:  # noqa: BLE001
        return None
    return modal_result(apps)


def modal_result(apps):
    """(state, title, body, severity) from {app name: state}. Plain words in titles (QA r2 C33)."""
    bad = [f"{c}={apps.get(c, 'missing')}" for c in CRONS if apps.get(c) != "deployed"]
    if bad:
        return ("bad: " + ", ".join(bad), f"Some scheduled jobs are off: {', '.join(c.split('=')[0] for c in bad)}",
                ", ".join(bad), "bad")
    return ("ok", "Scheduled jobs are running", f"{len(CRONS)} scheduled apps deployed", "good")


def check_github():
    if not shutil.which("gh") or _run(["gh", "auth", "status"])[0] != 0:
        return None
    rc, out = _run(["gh", "run", "list", "--limit", "1", "--json", "workflowName,conclusion,status"])
    try:
        run = json.loads(out)[0]
    except Exception:  # noqa: BLE001
        return None
    state = f"{run['workflowName']}:{run.get('conclusion') or run['status']}"
    failed = run.get("conclusion") == "failure"
    return (state, f"Last cloud run {'failed' if failed else 'worked'}: {run['workflowName']}", None,
            "bad" if failed else "good")


def check_domains():
    p = COLD_EMAIL / "logs" / "domain_health" / "history.csv"
    if not p.is_file():
        return None
    with p.open() as f:
        dates = [r["date"] for r in csv.DictReader(f) if r.get("date")]
    if not dates:
        return None
    last = max(dates)
    age = (ist_today() - date.fromisoformat(last)).days   # IST, not the runner's UTC date (QA r1 D21)
    if age > 40:
        return (f"stale:{last}", f"Domain health report is {age} days old", f"Latest report {last}. The monthly check is due.", "warn")
    return (f"ok:{last}", f"Domain health checked {last}", None, "info")


def check_invoice():
    p = WORKSPACE / "WF - DOOH" / "execution" / "invoicing" / "ledger.json"
    if not p.is_file():
        return None
    periods = [i["period"] for i in json.loads(p.read_text())["invoices"] if i.get("client") == "northwind"]
    if not periods:
        return None
    last = max(periods)
    t = ist_today()
    lm = f"{t.year - 1}-12" if t.month == 1 else f"{t.year}-{t.month - 1:02d}"
    if last < lm:
        return (f"behind:{last}", f"Northwind invoice not sent for {datetime.strptime(lm, '%Y-%m'):%B %Y}", f"Last one sent was for {datetime.strptime(last, '%Y-%m'):%B %Y}.", "warn")
    return (f"ok:{last}", f"Northwind invoiced through {last}", None, "info")


# ------------------------------------------------------------------ balances
def _get(url, **kw):
    import requests
    r = requests.get(url, timeout=30, **kw)
    r.raise_for_status()
    return r.json()


def bal_millionverifier():
    k = os.environ.get("MILLIONVERIFIER_API_KEY")
    if not k:
        return None
    return {"value": int(_get("https://api.millionverifier.com/api/v3/credits", params={"api": k})["credits"]),
            "unit": "credits"}


def bal_numlookup():
    k = os.environ.get("NUM_LOOKUP_API_KEY")
    if not k:
        return None
    q = _get("https://api.numlookupapi.com/v1/status", headers={"apikey": k})["quotas"]["month"]
    return {"value": int(q["remaining"]), "limit": int(q["total"]), "unit": "lookups"}


def bal_consulti():
    if not os.environ.get("CONSULTI_API_KEY"):
        return None
    sys.path.insert(0, str(COLD_EMAIL / "execution"))
    try:
        from consulti_client import Consulti
        d = Consulti(purpose="workos balance check").credits()      # free GET /credits
    except SystemExit:
        return None
    return {"value": int(d["lead_credits"]), "unit": "lead credits",
            "verification_credits": d.get("verification_credits")}


def bal_anymailfinder():
    k = os.environ.get("ANYMAIL_FINDER_API_KEY")
    if not k:
        return None
    d = _get("https://api.anymailfinder.com/v5.1/account", headers={"Authorization": k})
    return {"value": int(d["credits_left"]), "unit": "credits"}


BALANCES = {"millionverifier": ("MillionVerifier", bal_millionverifier), "numlookup": ("numlookup", bal_numlookup),
            "consulti": ("consulti", bal_consulti), "anymailfinder": ("AnyMailFinder", bal_anymailfinder)}


def balances(cur):
    """Refresh each vendor whose last reading is from before today (IST). Returns a summary dict."""
    cur.execute("select value from os_settings where key='balances'")
    row = cur.fetchone()
    cur_bal = row[0] if row else {}
    cur.execute("select value from os_settings where key='balance_limits'")
    row = cur.fetchone()
    limits = row[0] if row else {}
    today, now, out = ist_today(), datetime.now(timezone.utc), {}
    for key, (label, fn) in BALANCES.items():
        prev = cur_bal.get(key) or {}
        if prev.get("taken_at"):
            if datetime.fromisoformat(prev["taken_at"]).astimezone(IST).date() == today:
                out[key] = "fresh"
                continue
        try:
            res = fn()
        except Exception as e:  # noqa: BLE001
            out[key] = f"error {type(e).__name__}"
            continue
        if res is None:
            out[key] = "no key"
            continue
        res.setdefault("limit", limits.get(key))
        res["taken_at"] = now.isoformat()
        cur_bal[key] = res
        out[key] = res["value"]
        lim = res.get("limit")
        if lim and res["value"] < 0.10 * lim:
            add_event(cur, "alert", f"{label} balance low: {res['value']:,} of {lim:,}",
                      f"Under 10% of the plan total ({res['unit']}). Top up before the next send.", "bad", SOURCE)
    cur.execute("""insert into os_settings(key,value) values ('balances',%s::jsonb)
                   on conflict (key) do update set value=excluded.value, updated_at=now()""", (json.dumps(cur_bal),))
    cur.execute("insert into os_settings(key,value) values ('balance_limits',%s::jsonb) on conflict (key) do nothing",
                (json.dumps(limits),))
    return out


def unavailable_result(name):
    # The title stays the same for a given check, so the push dedupe on (source, title) still works.
    return ("unavailable", f"The {name} check cannot run in the cloud", "It needs your laptop. It is skipped for now.", "warn")


def main():
    checks = {"modal": check_modal, "github": check_github, "domains": check_domains, "invoice": check_invoice}
    now = datetime.now(timezone.utc)
    written, skipped = [], []
    with connect() as conn, conn.cursor() as cur:
        cur.execute("select value from os_settings where key='heartbeat_state'")
        row = cur.fetchone()
        state = row[0] if row else {}
        for name, fn in checks.items():
            res = fn()
            if res is None:
                # A check that cannot run is a state of its own, not a silent skip: in the GitHub
                # Action the modal/gh/local-file checks all return None, so the heartbeat was blind
                # every hour with a green run. One event when it goes blind, one when it recovers.
                skipped.append(name)
                res = unavailable_result(name)
            st, title, body, sev = res
            if state.get(name) != st:
                cur.execute("""insert into os_events(kind,title,body,severity,area,source,occurred_at)
                               values ('system',%s,%s,%s,'work',%s,%s)""", (title, body, sev, SOURCE, now))
                written.append(f"{name}: {title}")
                state[name] = st
        state["updated_at"] = now.isoformat()
        cur.execute("""insert into os_settings(key,value) values ('heartbeat_state',%s::jsonb)
                       on conflict (key) do update set value=excluded.value, updated_at=now()""",
                    (json.dumps(state),))
        conn.commit()
        try:
            bal = balances(cur)
            conn.commit()
        except Exception as e:  # noqa: BLE001
            conn.rollback()
            bal = {"error": type(e).__name__}  # type only: a requests error text can carry a key in the URL
    print(json.dumps({"events": written, "skipped": skipped, "balances": bal}, indent=1))


if __name__ == "__main__":
    main()
