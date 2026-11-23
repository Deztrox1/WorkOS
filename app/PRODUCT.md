# PRODUCT.md — WorkOS (WorkOS)

Product truth for the app in `app/`. Visual decisions live in `../DESIGN.md` (regenerated from the shipped app on 2026-10-29). Full behaviour spec: `../PRD.md`.
Written 2026-10-27 from the PRD, the user's build briefs (2026-10-09 to 2026-10-27) and the running app. Facts marked
(inferred) come from those briefs rather than a live interview; the user corrects them by editing this file.

## Platform

web (phone browser at 390 px and a laptop at 1280 px and up; Capacitor 8 layout, no native build). Single URL behind a
login: https://os.example.com. Light and dark, switched by a toggle in the app, system theme as the default.

## Who and when

One user, the owner of a one-person AI automation agency (Acme) who also runs cold outreach campaigns, teaches, and
keeps personal routines (gym, walk, flute, food). Two moments a day:

| Moment | Where | Job |
|---|---|---|
| Any time, phone or laptop | Today (the war room, `/`) | "What do I do right now, and what comes after it", for work and personal together |
| 21:30 IST, laptop | Plan (`/plan`) | "Tell it what tomorrow is, pick tomorrow's tasks, close today" |
| Any time | Task row | "Hand this to Claude Code so it works on it while I do something else" |

The user describes it as a chief of staff: the product tells him what to do; he does not want to think about where
things live. He is lazy by his own description and wants the app to carry the ordering.

## What it does

Lists and plans. Tasks, reminders, a day plan (plan line, review, mood, picked tasks), habits with streaks, notes,
campaign snapshots (Instantly email, GHL SMS) collected hourly, a finance ledger with a profit target, vendor balances,
and a system feed of events from collectors. It sends Web Push for due reminders, habits, tasks and bad events.

New in this round: a request queue to Claude Code. The user presses "Ask Claude" on a task or types a free request;
the app stores a brief; a poller on the VPS fires a Claude Code routine (the user's subscription) with that brief; the
routine works in the `WorkOS` repo and writes back a result. The app shows "not started yet", "working", done.
Until the routine is linked, the only path is "Copy brief and open Claude Code": the app records the hand-off on the
task row ("With Claude Code since 10:30. Tick the task when done.") and never claims Claude has started.

## What it is not

Not a nag machine: no escalation, no auto-dropping, no streak shaming. The app lists, the user decides. Not an agent:
the app itself makes no AI calls, sends no email, spends no money. Campaign "why" stays in the cold outreach playbook.

## Modes

Personal and Work are a filter over one database, chosen on the first screen and remembered per device. Habits are
personal only. Campaigns and Finance are work only. Tasks, reminders, notes and events carry an area.

## Durable constraints

- Times in Asia/Kolkata. Greeting flips at 14:00. Evening state from 18:00.
- Copy in third-grade English. No em dashes. No exclamation marks. A button says what happens.
- 44 px touch targets. Keyboard reachable. AA contrast in both themes. No CDN fonts, no analytics, no third-party scripts.
- Supabase is the only backend; RLS owner lock; the publishable key is the only key in the bundle.
- Four list states everywhere: loading, empty, offline (banner: "You are offline. This is how things stood at HH:MM."), error with Retry.
- No guilt words: no "late", no minus-day counts, no "missed" on anything he chose. A past due date shows as the date.
- Settings must not show the Supabase URL or key. "Use sample data" stays, as a separate control.

## Evidence the user named

Finance: Anthropic 118, Instantly 107, Winnr 69, GoSimless 16, Google Workspace 3 USD a month; profit target 1,000 USD
a month; Skillcamp invoice (September) is revenue. Balances: consulti, numlookup and others the heartbeat collects, each
with a renewal date when known.

## Brand commitments

Name "WorkOS" in the product (the folder and repo say WorkOS; the user calls it his operating system). Logo: a W
mark whose last stroke rises into a tick, files in ~/Downloads/workos-logo/. The user rejected the first visual pass:
cobalt-on-grey "looks like AI slop"; he asked for elegant and stylish, both themes, a visible theme toggle. (inferred)
He suggested using screenshots plus an image model as design references. No aesthetic was pinned beyond that.

## Stack

Vite 6, React 18, TypeScript, hash routes, supabase-js, chrono-node, date-fns-tz, Lucide icons, @fontsource fonts.
Tests: vitest and Playwright (mock mode `?mock=1`, pinned clock). Deploy: `infra/deploy_web.sh` to the Hostinger VPS.
