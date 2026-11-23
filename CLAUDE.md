# CLAUDE.md — WorkOS

The user's personal operating system: one web app behind a login on its own URL, two modes (personal,
work), for looking at the day in the morning, planning the next day in the evening, keeping tasks and
reminders, and seeing campaign and system state. **Capacitor 8 project layout, web target only, no Android or iOS build until asked. Never hosted under
example.ai.** Live at `https://os.example.com` since 2026-10-26. Data in Supabase (`os_*`); push, calendar and Claude-routine timers run on the VPS. `PRD.md` and `DESIGN.md` (both at the workflow root) are the spec; read them before UI changes.

## The 3-Layer Architecture

| Layer | Where | What |
|---|---|---|
| Directive | `directives/workos.md` | what the app is, the data model, the rules |
| Orchestration | this file | decisions, autonomy, what never happens |
| Execution | `app/` (Vite + React + Capacitor), `db/` (migrations, seed, apply), `execution/collectors/` (hourly GitHub Actions: campaign_pulse, ops_heartbeat, finance_pulse, retention, watchdog), `execution/push/` (VPS timers: push_due, gcal_sync, claude_fire), `execution/claude_result.py`, `infra/` (deploy_web.sh, nginx) | the code |

## What it is NOT

- Not a nag machine. It lists what is waiting; the user decides. No escalation ladders, no auto-dropping.
- Not an agent. The app makes no AI calls, sends no email, spends no money.
- Not a replacement for the logbook. Campaign "why" stays in `cold-outreach-playbook`.

## Entry points

```bash
cd "WF - WorkOS"
python3 db/apply.py --dry-run            # pending migrations
python3 db/apply.py --apply              # apply (also runs in .github/workflows/workos-migrate.yml)
python3 db/seed_initial.py               # idempotent seed (idle items as tasks, habit starters)
python3 execution/collectors/campaign_pulse.py   # Instantly + GHL snapshots -> os_campaign_snapshots
python3 execution/collectors/ops_heartbeat.py    # Modal / ledger / domain-health -> os_events
python3 execution/push/gcal_link.py              # once, on the Mac: owner signs in, token goes to the VPS (never revoke it)
```

```bash
# app (needs Node 22: export PATH="$HOME/.nvm/versions/node/v22.23.4/bin:$PATH")
(cd app && npm run dev)                 # local dev server (dev:mock runs on fixtures)
(cd app && npm run lint && npm run test && npm run e2e) # eslint, vitest, Playwright (mock mode, clock pinned)
(cd app && npm run build)               # tsc --noEmit + vite build
bash infra/deploy_web.sh                # build + rsync to VPS /var/www/workos + verify (Level 2, confirm first)
```

Web app: `app/` (Vite + React + TS, Capacitor 8 layout, web only). Live at
`https://os.example.com`.
The anon key is baked in at build time (`app/.env.production`, ignored); `?mock=1` runs on fixtures (Settings > System switches back).
Push: `execution/push/push_due.py` as `workos-push.timer` on the VPS. QA reports in `logs/`.

## Data

Supabase project **WorkOS** `yourprojectref` (Sydney, its own project since 2026-10-23; the cold email logbook project is separate), tables `public.os_*` (see the directive). Connection in `WF - WorkOS/.env` (ignored). Schema changes are
append-only files in `db/migrations/NNNN_*.sql`; an applied file is never edited. The `outreach` schema
belongs to Cold Email and is never touched from here.

## Autonomy

| Action | Level |
|---|---|
| Read Supabase, Instantly, GHL, Modal, ledgers | 1 |
| Write to `os_*` tables from collectors | 1 (logged in `os_events`) |
| Apply a migration | 2 (dry-run first) |
| Deploy the web app (`bash infra/deploy_web.sh`) | 2 (confirm first; the PRD and design gate was crossed at launch) |
| Write timed tasks to the owner's primary Google Calendar, and read it (`gcal_sync.py`) | 1 (only events the app made are ever changed or deleted) |
| Fire the Claude Code routine with a queued brief (`claude_fire.py`) | 1 (the user pressed Send; the routine itself never sends or spends) |
| Anything that writes to Instantly, GHL, Gmail, or spends money | not in this workflow |

## Secrets

`SUPABASE_DB_URL` (repo secret, exists), `INSTANTLY_API_KEY`, `GHL_API_KEY`, `GHL_LOCATION_ID`,
`GHL_BRIGHTPATH_API_KEY`, `GHL_BRIGHTPATH_LOCATION_ID`, `OPENROUTER_API_KEY` (repo secrets, user adds; `workos-collect.yml` header lists them). VPS-only budget settings live in `/etc/workos/claude.env`. Locally they are read
from `WF - Cold Email/.env`. The app's Supabase URL and anon key are build-time env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)
set in the build Action, never committed. Anon has no grants (migration 0003), so the key alone reads nothing.

## Shared lenses

`storytelling` does not apply (no copy). `directives/skill_craft_standard.md` applies to any skill added here.

## Changelog

| Date | Change | Reason |
|---|---|---|
| 2026-10-29 | QA round 2 built (`logs/qa-r2-plan.md`): migration 0008 live (only the owner's app session can ask Claude, no request can be rewritten or re-queued, copy hand-off, fire log, budget in `/etc/workos/claude.env`, snooze copies, push host check, 24 h baseline view), migration guard refuses switching guards off, poller expires rows after 24 h; Today: First is his first pick, pick order saved, done rows stay struck, no "late", evening ends on a closing line; Claude while not linked is copy-only; add button in the top bar; Settings and Claude on paper; watchdogs, safe nginx swap, atomic web releases. Infra review written (`logs/qa-r1-infra.md`) | Owner: two QA rounds from every angle, then rebuild |
| 2026-10-29 | QA round 3 by fresh reviewers (`logs/qa-r3-*.md`): 4 P1s fixed (migration guard now checks results, picks stay first, Claude-held picks named, honest loading line); migration 0009 live; poller adds the hard rules itself; DESIGN.md regenerated from the shipped app | Owner: redo the QA after the build and fix what it finds |
| 2026-11-07 | Google Calendar both ways (migration 0010, `workos-gcal` timer, `gcal_link.py`); `/` is now the war room: both areas, Now and Next, one order, calendar blocks in it; evening close moved to `/plan`; screens load on demand; robots.txt stops blocking so noindex is read. Plan: `logs/qa-r4-plan.md` | Owner: "the brain becomes this application, and I just have to execute" |
| 2026-11-18 | Corrected stale facts (app live, not "not built"; PRD/DESIGN paths; 5 collectors; OPENROUTER_API_KEY name; deploy gate), fixed the broken code fence, added a verified Commands block, moved 6 old changelog rows to `logs/changelog.md` | claude-md-improver audit 2026-11-14 (logs/reviews/claude-md-audit-2026-11-14.md) |

Older rows (6) are in `logs/changelog.md` under "2026-11-18: CLAUDE.md changelog rows relocated", word for word.
