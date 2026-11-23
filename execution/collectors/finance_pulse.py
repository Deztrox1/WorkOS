#!/usr/bin/env python3
"""
finance_pulse: invoices from the DOOH invoicing ledger become revenue entries in os_finance_entries.
READ ONLY toward the ledger (WF - DOOH/execution/invoicing/ledger.json).

One entry per invoice number: source 'ledger', source_ref = invoice_no, label = client label,
amount = total, currency as issued, month = first day of the issue-date month, notes = status
('sent' when emailed, else 'draft'). Rows whose note starts SUPERSEDED, and test clients, are skipped.
When a number appears twice the later row wins. A user-edited status (notes other than draft/sent,
e.g. 'paid') is never overwritten.

The ledger lives in the workspace, not in a pushed repo, so in GitHub Actions the file is absent:
the collector logs one line and exits 0.
"""
import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import WORKSPACE, connect, load_env  # noqa: E402

load_env()
LEDGER = WORKSPACE / "WF - DOOH" / "execution" / "invoicing" / "ledger.json"
LABELS = {"northwind": "Northwind", "contoso-finance": "Contoso Finance", "skillcamp": "Skillcamp"}
SKIP_CLIENTS = {"acme-test"}
CURRENCIES = {"USD", "INR", "GBP"}     # os_finance_entries check constraint (0007)


def parse_date(s):
    for fmt in ("%d %b %Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except (ValueError, TypeError):
            pass
    return None


def entries(ledger):
    out = {}
    for i in ledger.get("invoices", []):
        no, client = i.get("invoice_no"), i.get("client")
        if not no or client in SKIP_CLIENTS or str(i.get("note", "")).upper().startswith("SUPERSEDED"):
            continue
        d = parse_date(i.get("date"))
        if not d:
            continue
        cur = i.get("currency", "USD")
        if cur not in CURRENCIES:
            # One odd invoice must not stop the whole sync (QA r2 D14).
            print(f"[finance] skipping {no}: currency {cur!r} is not one of {', '.join(sorted(CURRENCIES))}")
            continue
        out[no] = dict(ref=no, label=LABELS.get(client, (client or "client").replace("-", " ").title()),
                       amount=i["total"], currency=cur, month=d.replace(day=1),
                       notes="sent" if i.get("emailed") else "draft")
    return list(out.values())


def main():
    if not LEDGER.is_file():
        print(f"[finance] ledger not found at {LEDGER} (expected in Actions: it is a local file). Skipping.")
        print(json.dumps({"skipped": True}))
        return
    rows = entries(json.loads(LEDGER.read_text()))
    c = {"inserted": 0, "upserted": 0}
    with connect() as conn, conn.cursor() as cur:
        for r in rows:
            cur.execute("""insert into os_finance_entries(kind,label,amount,currency,recurrence,month,source,source_ref,notes)
                           values ('revenue',%(label)s,%(amount)s,%(currency)s,'one_time',%(month)s,'ledger',%(ref)s,%(notes)s)
                           on conflict (source, source_ref) where source_ref is not null do update set
                             label=excluded.label, amount=excluded.amount, currency=excluded.currency, month=excluded.month,
                             notes = case when os_finance_entries.notes in ('draft','sent') then excluded.notes
                                          else os_finance_entries.notes end
                           returning (xmax = 0)""", r)
            c["inserted" if cur.fetchone()[0] else "upserted"] += 1
        conn.commit()
    print(json.dumps({"invoices": len(rows), **c}))


if __name__ == "__main__":
    main()
