#!/usr/bin/env python3
"""
Seed WorkOS with the idle inventory (2026-10-09), starter habits/reminders and settings.
Idempotent: tasks upsert on (source, source_ref); habits/reminders match on title/name;
settings upsert on key. Safe to re-run; never duplicates, never deletes.

    python3 seed_initial.py
"""
import json, sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import apply  # noqa: E402  (reuses db_url())
import psycopg  # noqa: E402

AREA = {"campaign": "cold-email", "list": "cold-email", "prospect": "sales", "client": "sales",
        "infra": "ops", "decision": "ops"}
AS_OF = "as of 2026-10-09"

# (row, item, area_col, since, days, waiting_for, next_action, est_min, cost_usd, due, priority)
INV = [
 (1, "Northwind: monthly check-in + invoice", "client", "2026-09-01", 38, "you run the invoice tool", "Run the invoice tool for last month, then send the check-in", 10, None, "2026-10-10", 1),
 (2, "Dental clinics campaign: 6 drafts held", "campaign", "2026-08-06", 64, "a go/kill on the plan", "Decide: launch as one version now, or park it", 10, None, None, 2),
 (3, "Regional accountants list: 5,000 emails, no campaign", "list", "2026-08-06", 64, "a check it was not already sent", "Cross-check vs sent list, then queue (or drop it)", 2, None, None, 2),
 (4, "Blue Heron Capital follow-up draft", "prospect", "2026-08-31", 39, "you send the draft, or mark Lost", "Open the draft and send, else mark Lost", 5, None, "2026-10-06", 1),
 (5, "Wholesale price for the white-label offer", "decision", "2026-08-25", 45, "a price (you write it)", "Write one price number, or drop the idea", 15, None, None, 2),
 (6, "Reply classifier returned empty in last run", "infra", "2026-10-01", 8, "someone to check the model id", "Agent: check the model id in the classifier", 20, None, None, 2),
 (7, "Roofers SMS: 900 imported, 0 sent last week", "campaign", "2026-10-02", 7, "you write the SMS template", "Finish the SMS message and turn the workflow on", 30, None, None, 2),
 (8, "Data source spends over the $5 gate", "decision", "2026-09-29", 10, "picks over the $5 gate", "Tick which sources you want; default none", 5, 20.00, None, 2),
]
# Table 3 rows not already covered by Table 1
T3 = [
 ("t3-plumbing", "Plumbing co (Jordan Lee): call", "sales", "Call Mon / Tue", "Call Mon / Tue (Call Booked)", "2026-10-20", 2, "Not due yet (from Table 3, follow-ups)."),
 ("t3-roofing", "Roofing co (Casey Diaz): reconnect gently", "sales", "Reconnect gently", "Reconnect gently (Call Done)", "2026-11-02", 3, "Not due yet (from Table 3, follow-ups)."),
]
HABITS = [  # name, days (0=Sun), time
 ("Gym", [1,2,3,4,5,6], "14:15"), ("Walk", [0,1,2,3,4], "21:30"),
 ("Flute practice", [0,1,2,3,4,5,6], "19:00"), ("Food log", [0,1,2,3,4,5,6], "13:00"),
]
REMINDERS = [("Plan tomorrow", "personal", "21:15"), ("Morning look", "work", "08:30")]


def upsert_task(cur, t):
    cur.execute("select id from os_tasks where source=%s and source_ref=%s", (t["source"], t["source_ref"]))
    row = cur.fetchone()
    cols = ["title", "area", "project", "waiting_on", "next_action", "est_minutes", "cost_usd",
            "due_date", "priority", "notes", "sort_order"]
    if row:
        cur.execute("update os_tasks set " + ",".join(f"{c}=%s" for c in cols) + " where id=%s",
                    [t[c] for c in cols] + [row[0]])
        return "updated"
    allc = cols + ["source", "source_ref"]
    cur.execute(f"insert into os_tasks ({','.join(allc)}) values ({','.join(['%s']*len(allc))})",
                [t[c] for c in allc])
    return "inserted"


def main():
    counts = {"tasks_inserted": 0, "tasks_updated": 0, "habits": 0, "reminders": 0, "settings": 0}
    with psycopg.connect(apply.db_url()) as conn, conn.cursor() as cur:
        for (n, item, ac, since, days, wait, nxt, est, cost, due, pri) in INV:
            t = dict(title=item, area="work", project=AREA[ac], waiting_on=wait, next_action=nxt,
                     est_minutes=est, cost_usd=cost, due_date=due, priority=pri,
                     notes=f"Waiting since {since}; {days} days idle ({AS_OF}).",
                     sort_order=n, source="idle_inventory", source_ref=str(n))
            counts["tasks_inserted" if upsert_task(cur, t) == "inserted" else "tasks_updated"] += 1
        for ref, item, proj, wait, nxt, due, pri, note in T3:
            t = dict(title=item, area="work", project=proj, waiting_on=wait, next_action=nxt,
                     est_minutes=None, cost_usd=None, due_date=due, priority=pri, notes=note,
                     sort_order=100 + len(ref), source="idle_inventory", source_ref=ref)
            counts["tasks_inserted" if upsert_task(cur, t) == "inserted" else "tasks_updated"] += 1
        for i, (name, days, tm) in enumerate(HABITS):
            cur.execute("select 1 from os_habits where name=%s", (name,))
            if not cur.fetchone():
                cur.execute("insert into os_habits(name,area,days,time_local,active,sort_order) values (%s,'personal',%s,%s,true,%s)",
                            (name, days, tm, i)); counts["habits"] += 1
        for title, area, tm in REMINDERS:
            cur.execute("select 1 from os_reminders where title=%s", (title,))
            if not cur.fetchone():
                cur.execute("insert into os_reminders(title,area,repeat,time_local,active) values (%s,%s,'daily',%s,true)",
                            (title, area, tm)); counts["reminders"] += 1
        # timezone always set; seeded_at only written once
        cur.execute("insert into os_settings(key,value) values ('timezone',%s::jsonb) on conflict (key) do update set value=excluded.value, updated_at=now()",
                    (json.dumps("Asia/Kolkata"),))
        cur.execute("insert into os_settings(key,value) values ('seeded_at',%s::jsonb) on conflict (key) do nothing",
                    (json.dumps(datetime.now(timezone.utc).isoformat()),))
        counts["settings"] = 2
        conn.commit()
        cur.execute("select count(*) from os_tasks"); counts["tasks_total"] = cur.fetchone()[0]
        cur.execute("select count(*) from os_habits"); counts["habits_total"] = cur.fetchone()[0]
        cur.execute("select count(*) from os_reminders"); counts["reminders_total"] = cur.fetchone()[0]
    print(json.dumps(counts))


if __name__ == "__main__":
    main()
