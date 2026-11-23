# WorkOS — directive

## Purpose

One place, on the phone and on the laptop, to see what is waiting, plan the day, keep reminders, and
watch campaign and system state. Personal and work in one app with a mode switch on the first screen.

## Modes

| Mode | Shows |
|---|---|
| Personal | habits (gym, walk, flute, food), personal tasks and reminders, personal feed items |
| Work | work tasks (the idle items from the 2026-10-09 scan were loaded here), campaigns, system feed, work reminders |

Every row carries `area` = `work` or `personal`. The mode switch is a filter, not a separate database.

## Data model (Supabase, `public.os_*`)

| Table | One row is | Written by |
|---|---|---|
| `os_tasks` | a thing to do, with `waiting_on`, `next_action`, `est_minutes`, `cost_usd`, `planned_for` | the app; seed |
| `os_reminders` | a time-based nudge, one-off or repeating; a snooze copy carries `snooze_of` and is deleted once it fires | the app; seed; `push_due.py` deletes fired snooze copies |
| `os_days` | one day: morning `plan`, evening `review`, the picked `top_task_ids` | the app |
| `os_habits`, `os_habit_logs` | a repeating personal routine and its daily tick | the app; seed |
| `os_events` | the feed: something a collector saw (campaign change, alert, invoice gap) | collectors |
| `os_campaign_snapshots` (+ views `os_campaigns_latest`, `os_campaign_daily`, `os_campaign_baseline24`) | one campaign's totals at one time | `campaign_pulse.py` |
| `os_settings` | key/value (timezone, heartbeat state, balances, balance_renewals, flags_seen, reminders_done, plan_skip, gcal_refused, claude_routine) | seed, collectors, the app; `owner_uid` and `claude_routine` only from the server (migrations 0007, 0008) |
| `os_claude_requests` | one brief handed to Claude Code: `handoff` routine (queued, firing, sent) or copy (sent when he pastes it himself), then done, failed, cancelled | the app (insert only from the owner's signed-in session); `claude_fire.py`; `claude_result.py` |
| `os_calendar_events` | one Google Calendar event on the primary calendar, today-1 to today+3 (title, times, two checked links; no description, no guests) | `gcal_sync.py` only; the app reads |
| `os_calendar_links` | a task and its calendar copy, with the state both last agreed on | `gcal_sync.py` only; the app has no access |
| `os_calendar_state` | one row: linked, last good check, a plain problem line, the day's counts | `gcal_sync.py` only; the app reads |
| `os_claude_fires` | one POST to the routine, counted against `CLAUDE_FIRE_BUDGET` (VPS env, default 20, ceiling 50) | `claude_fire.py` only; the app reads |

Rules: RLS on, only the owner (`os_is_owner()`, migration 0005) may read and write, anon nothing. Single user. Times in
Asia/Kolkata. Migrations are append-only, and `db/apply.py` refuses any migration that switches off a guard
(disable trigger, redefining a guard function, touching `owner_uid`, a policy with OR or another role).
A Claude request can never be rewritten or turned back into a queued one (0008), so a holder of the DB URL cannot
forge or replay a brief short of dropping the trigger, which the guard refuses.

## Collectors (GitHub Actions, cron at :17; GitHub fires it only every 3 to 8 h in practice)

| Script | Reads | Writes |
|---|---|---|
| `campaign_pulse.py` | Instantly campaigns, GHL workflows (both accounts) through the daily-summary clients | a snapshot per campaign; an event only when something changed |
| `ops_heartbeat.py` | Modal app list, domain-health history, invoice ledger | a system event only when state changed |

Collectors read external systems and write only to `os_*`. They never write back to Instantly, GHL or Gmail.
Watchdogs: the collect job fails (GitHub emails the owner) when the VPS reminder sender has not run for 10 min,
and the VPS sends one phone alert a day when campaign numbers are over 12 h old.

## Google Calendar (VPS timer `workos-gcal`, every 2 minutes)

Two ways, primary calendar of alex@example.com only. Rules in `logs/qa-r4-plan.md`.

| Direction | What happens |
|---|---|
| Google to the app | Every event lands in `os_calendar_events`, and the war room puts it in the day's order |
| App to Google | An open task with a date and a time gets a calendar event. Changed task, changed event. Dropped, deleted or untimed task: the event goes |
| Moved in Google | The task follows, its date, time and length. Newest change wins when both moved. The title belongs to the app: a rename in Google is left alone and never reaches a task or a brief |
| Guests or a repeat added in Google | The event stops being managed: the link is released and the event is left alone. The task keeps its date and time |
| An invite nobody answered | Shows as Free with no Join link, so a stranger cannot take the top of the day |
| Daily limits (IST) | 10 tasks may lose their time to Google, 200 changes may go to Google. Past that the rest wait for tomorrow, the owner gets one alert, and the problem line stays until the count resets. Each cleared task's old date and time is in its Activity row |
| Deleted in Google | The task stays, its time is cleared |

The app deletes only events it made (fixed id `pos` + task id, listed in `os_calendar_links`). Reminders and habits never go
to Google. Token: `calendar.events` scope only, in `/etc/workos/gcal.env`, read only by that unit, written by
`execution/push/gcal_link.py` after one owner consent. It shares its OAuth client with gws and Modal `acme-google`, so
never revoke it: revoking one token kills the grant for all of them.

## The app

Specified in `../PRD.md`. Web app behind a login on its own URL (never example.ai), Vite + React +
TypeScript in a Capacitor 8 project layout, web target only. Built after the user's design is approved.
No AI calls, no sends, no spends.

## What comes later (not built)

Email triage and replies from the app (needs a new Google OAuth client), news lanes, push from the server
(needs a Firebase project), approve-to-execute campaign changes. Each is a new migration
plus a collector, never a change to the rules above.

## Changelog

| Date | Change | Reason |
|---|---|---|
| 2026-10-13 | First version | Build of the WorkOS |
| 2026-10-17 | App section now points at PRD.md; hosting and Android removed | User correction |
| 2026-10-27 | `os_claude_requests` and the Claude Code link (routine fired from the VPS poller); owner-only rule | User: command Claude Code from the app |
| 2026-10-29 | QA round 2: migration 0008 (forge and replay closed, copy hand-off, fire log, snooze copies, push host check, 24 h baseline), wider migration guard, watchdogs, cron throttling noted | `logs/qa-r2-plan.md` |
| 2026-10-29 | Round 3: migration 0009 (server clock on insert, claude.ai/code links, sender keys server-only), `db/apply.py` checks every migration from 0009 by its result (pinned catalog shape) | `logs/qa-r3-security.md` R3S01 |
| 2026-11-07 | Google Calendar both ways (migration 0010, `gcal_sync.py`, `gcal_link.py`); `/` is the war room for both areas, evening close moved to `/plan` | Owner: calendar in and out, one screen, in order, no clutter |
| 2026-11-07 | Calendar rules after QA r4: title stays the app's, daily limits, guests or a repeat end management, unanswered invites are Free, mirror cut to today+3, links table closed to the app | `logs/qa-r4-plan.md` calls O to T |
