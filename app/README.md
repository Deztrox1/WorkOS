# WorkOS app (v1)

Vite 6 + React 18 + TypeScript (strict) + react-router hash routes + Supabase. Plain CSS tokens from `../DESIGN.md`.
Capacitor 8 project layout (`capacitor.config.ts`, appId `com.example.workos`, webDir `dist`), web target only: no android or ios platform is added.
Specs: `../PRD.md` (v3), `../USER_STORIES.md`, `../DESIGN.md`.

## Setup

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.4/bin:$PATH"   # Node 22 (the Capacitor 8 CLI refuses Node 20)
cd app
npm install
npm run dev            # http://localhost:5173
```

## Env and where the anon key goes

| Variable | Default | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://yourprojectref.supabase.co` | WorkOS project. Other `.env` keys (values never committed): `SUPABASE_DB_URL`, `SUPABASE_SECRET_KEY` |
| `VITE_SUPABASE_ANON_KEY` | empty | Put it in `app/.env.local`. Never committed (`.gitignore`). Anon has no grants, the key alone reads nothing |
| `VITE_VAPID_PUBLIC_KEY` | empty | Falls back to `../infra/vapid_public.txt` at build time |
| `VITE_DATA` | empty | `mock` forces mock mode |

No rebuild is needed to try live data: open Settings, System, type the Supabase URL and anon key, tap "Use live data". They are stored in this browser only (localStorage `workos.live`) and are used when the build has no key.

## Mock vs live

| Mode | How it starts | What it is |
|---|---|---|
| Live | a key in the build, or typed in Settings | `src/lib/data/supabase.ts`: PostgREST, realtime, auth |
| Mock | `VITE_DATA=mock`, or a first visit with `?mock=1` (remembered; `?mock=0` leaves it) | `src/lib/data/mock.ts`: in-memory fixtures that mirror the seed (24 work tasks, 5 follow-ups, 4 habits, 2 reminders, 44 campaigns, 14 days of snapshots for 3, 3 events, 5 costs, 1 Skillcamp invoice, 2 notes, balances). State persists in localStorage (`workos.mock.v1`). Any email signs in except password `wrong-pass` |

Both implement one `DataClient` interface (`src/lib/data/types.ts`). Settings > System shows "Mock" or "Live" plus the URL.
In mock mode `window.__mock` exposes `reset()`, `seed()`, `get()`, `external()` (insert as another device), `setFail()`.

## Scripts

| Script | What |
|---|---|
| `npm run dev` / `npm run dev:mock` | dev server (live / mock) |
| `npm run build` | `tsc --noEmit` then `vite build` into `dist/` with base `/` |
| `npm run preview` | serves `dist/` on 127.0.0.1:4173 |
| `npm run lint` | eslint + typescript-eslint |
| `npm test` | vitest unit tests |
| `npm run e2e` | Playwright (builds, serves `vite preview`, runs both viewports) |

## Tests

* Unit: `src/shared/nextFire.test.ts` runs `../shared/next_fire_cases.json` (the same file `execution/push/tests/test_shared_fixture.py` runs against `shared/next_fire.py`). `src/lib/logic/logic.test.ts` covers the quick-add parser, grouping, sort, bounce %, 24 h delta, sparkline points, streaks, finance maths, and the copy scan (no em dash, no exclamation mark, no emoji).
* E2E: `e2e/*.spec.ts`, Chromium, mock mode, clock pinned to Thu 2026-10-22 09:00 IST with `page.clock`, device timezone America/Los_Angeles on purpose. `phone` project is 390x844, `*.desktop.spec.ts` run at 1280x800. Each file header lists the story IDs it covers. Fixtures are dated relative to the pinned day (the stories use 21 Oct; everything is shifted by one day).
* `e2e/screenshots.spec.ts` writes `screenshots/` (Today work and personal, Tasks, Plan, Campaigns, Finance, Notes, Settings at 390 and 1280, light and dark).
* First time: `npx playwright install chromium`.

## Push and offline

`public/sw.js` handles `push` and `notificationclick` and caches the app shell (network first) so Today opens offline. Settings > Enable asks for permission, registers the worker, subscribes with the VAPID public key and saves the row in `os_push_subscriptions` with the device name. While the app is open `src/lib/reminders.ts` fires banner + Notification at the same `nextFire` time. Slices are cached in localStorage; Today renders from them with "offline, last synced HH:MM" and writes are disabled.

## Known gaps

See `KNOWN_GAPS.md`.
