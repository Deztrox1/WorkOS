# WorkOS

A personal operating system: one web app behind a login, with personal and work modes, tasks,
reminders, a day plan, habits, campaign snapshots and a system feed.

| Part | Where |
|---|---|
| Web app (Vite + React + TypeScript, Capacitor 8 layout, web only) | `app/` |
| Database schema (Supabase / Postgres, append-only migrations) | `db/migrations/` |
| Hourly collectors (GitHub Actions) | `execution/collectors/` |
| Push, calendar sync and routine timers (VPS) | `execution/push/` |
| Deploy scripts and nginx config | `infra/` |
| Product spec and design | `PRD.md`, `DESIGN.md`, `USER_STORIES.md`, `directives/workos.md` |

## Run it locally (no backend needed)

```bash
cd app
npm ci
npm run dev:mock      # runs on built-in sample data
npm run test          # unit tests
npm run e2e           # Playwright, mock mode
```

## Configuration

Copy `app/.env.example` to `app/.env.local` and fill in your own Supabase project. Hostnames, project
refs and emails in this repo are placeholders (`example.com`, `yourprojectref`, `203.0.113.10`).
Never commit `.env` files or keys.
