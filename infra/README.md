# WorkOS infra

| Piece | File | Where it runs |
|---|---|---|
| nginx site | `nginx/workos.conf` + `nginx/workos-app.snippet` + `nginx/workos-headers.snippet` | VPS 203.0.113.10, `/etc/nginx/sites-available/workos` (symlinked), snippets in `/etc/nginx/snippets/` |
| Web deploy | `deploy_web.sh` (`--nginx` reinstalls the site, `--no-build`, `DIST=` override) | from the Mac, rsync to `/var/www/workos/` |
| Push timer | `../execution/push/install_vps.sh` | systemd `workos-push.timer`, every minute, env in `/etc/workos/env` only |
| Claude fire timer | same installer | systemd `workos-claude.timer`, every minute, its own unit and 300 s timeout (QA r1 D3). Env: `/etc/workos/env` plus `/etc/workos/claude.env` (root, 0600; the routine id, token and daily cap; the push unit never reads it, QA r2 S13) |
| Routine prompt | `claude_routine_prompt.md` | pasted into the routine on claude.ai; the committed copy is the reviewed one. Carries a `Prompt version` line that each result echoes |
| Code owners | `../.github/CODEOWNERS` | the owner must review `.github/`, `db/`, `execution/`, `infra/` (needs branch protection with code-owner review on `main`) |
| VAPID public key | `vapid_public.txt` (committed). The private key lives only in `/etc/workos/env` on the VPS | |

Hostnames: `os.example.com` is the live site, on port 443 with its own Let's Encrypt cert (runs to 2027-01-24, renewed by certbot); its port-80 block only redirects and serves the cert challenge. `contoso.example.net` is the retired name: it redirects to the live site, cert until 2026-12-04.

The CSP in `workos-headers.snippet` limits `connect-src` to the Supabase host `yourprojectref.supabase.co`; change it there if the project changes.

## Claude Code link (added 2026-10-27, hardened 2026-10-28)

"Ask Claude" in the app writes a row to `os_claude_requests`. A database trigger stamps `created_by` with the
signed-in user and refuses the insert unless that is the owner, so a script holding the DB URL cannot queue a
brief by a plain insert (QA r1 Q2). Since migration 0008 the insert must also come from the owner's app session, the
status can only move forward, and a hand-off the owner copies into Claude Code himself is stored as `sent` with
`handoff = 'copy'` (nothing fires it). Every minute `workos-claude.timer` on the VPS runs `claude_fire.py`:

| Step | What happens |
|---|---|
| Sweep | queued rows not created by the owner -> `failed`; a row stuck in `firing` over 10 min -> `failed` ("unknown, check routines"); rows with 3 attempts -> `failed` |
| Claim | one row at a time: `queued -> firing`, `attempts + 1`, committed before the POST |
| POST | to the routine **WorkOS requests** (`trig_xxx`, https://claude.ai/code/routines) |
| Result | 2xx -> `sent` + session link. 429 or no connection -> back to `queued` (max 3 tries). Anything else (timeout after connecting, 5xx, odd reply) -> `failed` with a clear error, never re-sent automatically |
| Guard | every write-back is `where status='firing'`, so a Cancel tapped during the POST wins |
| Budget | at most `CLAUDE_FIRE_BUDGET` sends per IST day, read from `/etc/workos/claude.env` (default 20, ceiling 50; each POST counts, 5 per minute). Fires are counted in `os_claude_fires`, one row per POST. The old `os_settings.claude_fire_budget` row is ignored |

The routine follows `claude_routine_prompt.md` (brief text is data, never send or spend, only `claude/*`
branches, never `.github/`, `db/migrations/`, `db/apply.py`, `execution/` or `infra/`). It writes the outcome with `execution/claude_result.py`, which
only finishes a request that is `firing` or `sent`.

One-time setup (the token is only shown in the web UI):

1. Paste `claude_routine_prompt.md` into the routine, delete its weekly schedule trigger, and check the
   owner checklist at the bottom of that file.
2. Open the routine on https://claude.ai/code/routines, choose "Generate API token", copy the `sk-ant-oat01-...` value.
3. `execution/push/install_vps.sh` (installs both timers), then
   `execution/push/install_vps.sh --set-claude trig_xxx` and paste the token when asked.
   It lands in `/etc/workos/claude.env` (root, 0600), never in `/etc/workos/env`, and the script adds
   `CLAUDE_FIRE_BUDGET=20` there if the file has none. Older `CLAUDE_*` lines in `env` are moved over by the
   installer. Settings > Claude Code then says "linked".
4. The Claude GitHub App must have access to `WorkOS`, or the run fails at clone.

Do **not** put `SUPABASE_DB_URL` in the routine's cloud environment (this was step 3 before 2026-10-28).
That URL bypasses RLS: an agent fed injected text could read notes, finances and push keys, rewrite
`owner_uid` or queue more work for itself, and anyone with access to the environment can read it. Without it
the routine ends with its result as the final message and the owner marks the request done in the app.

Limits: 30 fires an hour per routine, 100 an hour per account, our own `CLAUDE_FIRE_BUDGET` a day (default 20, ceiling 50).

### Write-back role (design, not built)

If automatic write-back is wanted later, give the routine a role that can do only that, never the owner URL.
Checked live 2026-10-29: the `postgres` role of this project has **no grant option on schema `auth`**, so the
`usage on schema auth` grant below cannot be issued from the DB URL. That is why the narrow roles are not built
yet (migration 0008 closes the two shown bypasses without them); the grant has to be made by Supabase support
or another way the owner finds. Without it every update by the role fails, because the BEFORE UPDATE stamp
trigger (0007) calls `auth.uid()`.

```sql
-- a new migration, applied by the owner
create role claude_writeback login password '<generated>' noinherit;
grant usage on schema public to claude_writeback;
grant usage on schema auth to claude_writeback;     -- the stamp trigger calls auth.uid() (not grantable by postgres here)
grant select (id, status) on public.os_claude_requests to claude_writeback;
grant update (status, result, error, finished_at, sent_at) on public.os_claude_requests to claude_writeback;   -- claude_result.py also writes sent_at
-- RLS already applies to this role (it is not the table owner). UPDATE ... WHERE needs a SELECT policy too.
create policy os_claude_requests_writeback_read on public.os_claude_requests for select to claude_writeback
  using (status in ('firing','sent'));
create policy os_claude_requests_writeback on public.os_claude_requests for update to claude_writeback
  using (status in ('firing','sent')) with check (status in ('done','failed'));
```

It cannot insert (so it cannot queue work for itself), cannot read briefs or any other table, and can only move
an in-flight request to done or failed. Its URL (`postgresql://claude_writeback.yourprojectref:...@<pooler>`)
would be the only database value in the routine environment. The migration guard would need this policy
allowed by name (it does not call `os_is_owner()`). Better still: a Supabase Edge Function that takes a
one-time token included in the brief.

### Collector role (proposal, QA r1 Q2)

The hourly Action and the VPS timers use the owner DB URL today, which bypasses RLS. A narrow role per job.
Each role needs `usage on schema auth` too (the 0007 stamp triggers call `auth.uid()`), with the same
blocker as above, plus a new database password in the VPS env file and the GitHub secrets (a credential change
for the owner to approve). Planned as migration 0009, for the owner to schedule.

| Role | Grants | Used by |
|---|---|---|
| `os_collector` | insert on `os_events`, `os_campaign_snapshots`; insert/update on `os_sms_days`, `os_settings` (keys `heartbeat_state`, `balances`, `balance_limits` through a policy); select on those tables; delete on `os_campaign_snapshots`, read `os_events` for retention | `workos-collect.yml` (each step its own secret) |
| `os_pusher` | select on reminders, habits, habit_logs, tasks, events, push_subscriptions, settings, claude_requests (task ids only); update of the fired columns only; delete on `os_push_subscriptions` and snooze copies in `os_reminders` | `workos-push` |
| `os_claude_fire` | select/update on `os_claude_requests` (no insert), insert/select on `os_claude_fires`, select/update on `os_settings` key `claude_routine`, `owner_uid` read-only | `workos-claude` |

None of them can insert into `os_claude_requests` or change `owner_uid`.

## Google Calendar link

`workos-gcal.timer` runs `gcal_sync.py` every 2 minutes. Until `/etc/workos/gcal.env` exists it only records "not linked".

| Step | Command |
|---|---|
| Install or update the unit | `execution/push/install_vps.sh` (exits non-zero when the first gcal run fails) |
| Link (owner, once, on the Mac, sign in as alex@example.com, press Allow) | `python3 execution/push/gcal_link.py` (add `--client-file PATH` for an OAuth client of its own) |
| See how it is doing | Settings, Google Calendar, or `journalctl -u workos-gcal -n 20` |

`gcal_link.py` refuses any calendar but alex@example.com's and stores it as `GCAL_ACCOUNT`; the unit stops, changing nothing, if a list ever comes from another calendar. Deleting `gcal.env` unlinks: the next run empties the mirror and keeps the links.

Never revoke this token. It shares an OAuth client with gws and the Modal `acme-google` secret, and one revoke kills them all.

## Deploy order (round 4)

Order matters: the installer's first gcal run needs the new tables, and the web verify needs the new nginx config.

| # | Step | Command | If it fails |
|---|---|---|---|
| 1 | Commit and push | `/commit` | Nothing is live yet |
| 2 | Migration | `python3 db/apply.py --dry-run`, then `--apply` | One transaction: it rolls itself back |
| 3 | VPS units | `execution/push/install_vps.sh` | Red exit on the gcal run: read the journal. Old scripts and units are in `/root/workos-units.bak-*` |
| 4 | Web and nginx | `infra/deploy_web.sh --nginx` | A bad `nginx -t` restores the old config; a failed verify points the symlink back at the last release |
| 5 | Link the calendar (owner) | `python3 execution/push/gcal_link.py` | Nothing is written unless every check passes |

Rollback after step 5: delete `/etc/workos/gcal.env`. The next run empties the mirror and nothing else moves; events already on Google stay until a task changes. Web rollback: `ln -sfn` `/var/www/workos` at the previous folder in `/var/www/workos-releases/`. A plain `deploy_web.sh` does not install nginx, so its verify fails on an old config until `--nginx` has run once.

**Never roll the web back to a release older than 20261107.** The folders `20261029-201510`, `20261029-203907`, `20261029-204141` and `legacy-20261029-201510` still hold real client names in their public files (R4S01, R4X01), so pointing `/var/www/workos` at one puts those names back on the open web. Until a newer release exists, there is no safe older folder: fix forward with a new deploy. Deleting those four folders is the owner's call. Keep-last-5 will not clear them for several deploys.
