# WorkOS data layer

Supabase Postgres, tables in `public` prefixed `os_` (the `outreach` schema is never touched). Project: WorkOS (`yourprojectref`). `.env` keys: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_DB_URL`, `SUPABASE_SECRET_KEY` (values never committed).
Tables: `os_tasks`, `os_reminders`, `os_days`, `os_habits`, `os_habit_logs`, `os_events`,
`os_campaign_snapshots`, `os_settings`, view `os_campaigns_latest`, ledger `os_schema_migrations`.
v1 (migration 0004): `os_notes`, `os_finance_entries` (kind cost/revenue, monthly/one_time, `end_month`,
`source` seed/manual/ledger + `source_ref`), `os_push_subscriptions`, `os_sms_days` (pk day+account); columns
`os_events.pushed_at`, `os_tasks.pushed_at`, `os_habits.last_pushed_on`; unique index on `os_tasks (source, source_ref)`;
settings `profit_target`, `fx`, plus written by jobs: `balances`, `balance_limits`, `push_last_run`, `push_digest_on`.
0006: `os_claude_requests`. 0007 (QA round 1): status `firing`, columns `attempts`, `seen_at`, `created_by`
(stamped by a trigger, owner only), brief <= 20,000 chars, one open request per task; view `os_campaign_daily`
(last snapshot per campaign per IST day, 31 days); CHECKs on reminders, habits, finance, tasks; `owner_uid`
cannot be changed from the app; TRUNCATE revoked; setting `claude_fire_budget` (20).
No pg_net, Vault or pg_cron: push runs on the VPS (below), retention in the hourly Action.
RLS: only the owner (`os_is_owner()`: `auth.uid()` equals `os_settings.owner_uid`, migration 0005) reads and
writes; another signed-in user gets nothing; `anon` gets nothing. The ledger `os_schema_migrations` is closed
to both (0007). The DB URL (`postgres` role) bypasses RLS: treat it as the master key.

## Add a migration
1. New file `db/migrations/NNNN_name.sql` (next number). Never edit an applied file; apply.py refuses (sha256 ledger).
2. `python3 db/apply.py --dry-run`, then `--apply`. Needs `SUPABASE_DB_URL` (env or the repo `.env` only; `--apply`
   refuses a URL that does not name project `yourprojectref`). Needs `pip install "psycopg[binary]"`.
3. Push to main: `workos-migrate.yml` does the same.

The guard (pending files only; rules in the apply.py docstring) refuses destructive SQL, `USING (true)`, a
policy without `os_is_owner()`, redefining `os_is_owner`, SECURITY DEFINER without `search_path`, a new table
without RLS and an owner policy, a view without `security_invoker`, and grants to `authenticated` on objects the
file did not create. It also reads inside `execute '...'`. A CHECK can be widened only as a swap in one
statement: `alter table t drop constraint c, add constraint c check (...) not valid;`.
Add CHECKs `not valid`, then validate (see 0007's loop).

Tests: `python -m pytest db/tests/test_apply_lint.py` (no DB). To prove a migration applies, use a throwaway
Postgres, never the project:

```bash
docker run --rm -d --name wos-pg -p 55432:5432 -e POSTGRES_PASSWORD=x postgres:15
python db/tests/throwaway_apply.py postgresql://postgres:x@127.0.0.1:55432/postgres            # 0001..N + contract probes
WOS_TEST_DB_URL=postgresql://postgres:x@127.0.0.1:55432/postgres python -m pytest execution db/tests/test_apply_lint.py
docker stop wos-pg
```
(`--dirty` on a fresh container seeds rows that break the new rules before 0007, to prove the clean-up path.)

## Seed
`python3 db/seed_v1.py` is idempotent: the 5 recurring costs (source `seed`) and the `profit_target` / `fx` defaults (never resets an edited value).
`python3 db/seed_initial.py` is idempotent (tasks match on `source`+`source_ref`; habits and reminders on name/title).
Loads the 22 idle-inventory tasks + 2 follow-ups, 4 habits, 2 reminders, settings `timezone`, `seeded_at`.

## Collectors (hourly, `workos-collect.yml`)
| Script | Writes |
|---|---|
| `execution/collectors/campaign_pulse.py` | one `os_campaign_snapshots` row per Instantly campaign and GHL workflow per run (`raw.playbook_status` from the playbook README); `os_events` (kind `campaign`) on new replies/positives, bounce +3 points, status change; once a day after 02:00 IST yesterday's `os_sms_days` per GHL account (classifier via OpenRouter, STOP regex, `bad` event over 5% STOP) |
| `execution/collectors/ops_heartbeat.py` | `os_events` (kind `system`) when Modal crons, Actions, domain health or Northwind invoicing change state (`os_settings.heartbeat_state`); once a day `os_settings.balances` (MillionVerifier, numlookup, consulti, AnyMailFinder) with an `alert` event under 10% of a limit (`os_settings.balance_limits`, numlookup's comes from its API) |
| `execution/collectors/finance_pulse.py` | revenue rows in `os_finance_entries` (`source ledger`, one per invoice) from `WF - DOOH/execution/invoicing/ledger.json`; local only (skipped in Actions) |

GHL has no per-workflow counts, so SMS rows carry status only (counts are NULL); the day counts are per account in `os_sms_days`.

## Retention (`execution/collectors/retention.py`, hourly step in `workos-collect.yml`)
Snapshots older than 14 IST days fold to the last one per campaign per IST day (what `os_campaign_daily` shows);
read events older than 180 days are deleted; unread events never are. At most 20,000 rows per table per run.
`campaign_pulse` also stores the full `raw` object only when it changed since the previous snapshot (hash in
`raw.hash`); other rows keep only `playbook_status` / `location_id`.

## Push (`push-due`, VPS systemd timer every minute)
`execution/push/push_due.py` + `shared/next_fire.py` (tests: `python -m pytest execution/push/tests`). Each item is
sent, marked and committed on its own; a failed send is retried for 15 minutes. `claude_fire.py` runs in its own
unit, `workos-claude.timer` (see `infra/README.md`). Installed by
`execution/push/install_vps.sh` to `/opt/workos`, env in `/etc/workos/env` (SUPABASE_DB_URL, VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, VAPID_SUBJECT).
Public key: `infra/vapid_public.txt` (use it as `VITE_VAPID_PUBLIC_KEY`). Web hosting: `infra/` (see `infra/README.md`).
The app must clear `os_tasks.pushed_at` when it changes a task's due date or time, so the new time pushes again.

## Repo secrets (Settings -> Secrets -> Actions)
`SUPABASE_DB_URL`, `INSTANTLY_API_KEY`, `GHL_API_KEY`, `GHL_LOCATION_ID`, `GHL_BRIGHTPATH_API_KEY`, `GHL_BRIGHTPATH_LOCATION_ID`,
`OPENROUTER_API_KEY`, `MILLIONVERIFIER_API_KEY`, `NUM_LOOKUP_API_KEY`, `CONSULTI_API_KEY`, `ANYMAIL_FINDER_API_KEY`,
`GOOGLE_SERVICE_ACCOUNT_JSON` (whole file). Also `COLD_EMAIL_REPO_TOKEN` (read-only PAT on the private `cold-outreach` repo):
the collectors reuse its Instantly/GHL/consulti/classifier code and the playbook READMEs; it is checked out into `./cold-email`.

## Sample SQL for the app
```sql
-- latest campaigns
select * from os_campaigns_latest order by channel, status, campaign_name;

-- today's tasks (planned for today, or due today / overdue, still open). "Today" is the IST date:
-- current_date is the server's UTC date and is wrong between 00:00 and 05:30 IST.
select * from os_tasks
where status = 'open'
  and (planned_for = (now() at time zone 'Asia/Kolkata')::date
       or due_date <= (now() at time zone 'Asia/Kolkata')::date)
order by priority, due_time nulls last, sort_order;

-- campaign history for charts: one row per campaign per IST day
select * from os_campaign_daily order by taken_at asc limit 5000;

-- open (unread) events, newest first
select * from os_events where read_at is null order by occurred_at desc limit 50;
```

## Backup and restore (`workos-backup.yml`, nightly 02:11 IST)
The Action dumps `schema.sql` (schema of `public`: tables, views, functions, triggers, policies) and `os.dump`
(`pg_dump -Fc` of every `public.os_*` table, schema and data), tars them and encrypts the tar to the age
recipient in repo variable `BACKUP_AGE_RECIPIENT` (or the GPG key in `BACKUP_GPG_PUBLIC_KEY`). Without a key it
fails and uploads nothing. Artifact `workos-backup`, kept 30 days. The DB URL comes from the environment
secret `SUPABASE_DB_URL` of environment `backup`.

**Restore drill (do it once after the first backup, then after any schema change).** The throwaway database is
bound to localhost only, uses a random password, lives in a `mktemp -d` folder, and everything is removed at the
end, even when a step fails (QA r2 S07, D05):

```bash
# 0. key: age-keygen -o ~/.config/workos-backup.key   (once; put the printed "age1..." public key in
#    the repo variable BACKUP_AGE_RECIPIENT; keep the key file off GitHub, e.g. in 1Password)
REPO="<path to the WorkOS repo>"
W="$(mktemp -d)"; PW="$(openssl rand -hex 16)"
trap 'docker stop wos-restore >/dev/null 2>&1; rm -rf "$W"' EXIT       # cleanup even if a step fails
cd "$W"
gh run download --repo <owner>/WorkOS -n workos-backup -D "$W"
age -d -i ~/.config/workos-backup.key workos-*.tar.age | tar -x   # gives schema.sql, os.dump

# 1. a throwaway Postgres (never the live project): localhost only, random password, with the Supabase shim
docker run --rm -d --name wos-restore -p 127.0.0.1:55433:5432 -e POSTGRES_PASSWORD="$PW" postgres:17
until pg_isready -h 127.0.0.1 -p 55433 -q; do sleep 1; done
export R="postgresql://postgres:$PW@127.0.0.1:55433/postgres"
psql "$R" -f "$REPO/db/tests/supabase_shim.sql"

# 2. schema, then data with triggers off (the created_by trigger would refuse rows without a signed-in owner)
psql "$R" -v ON_ERROR_STOP=0 -f schema.sql          # "already exists" for the shim's objects is expected
pg_restore --data-only --no-owner -f data.sql os.dump
psql "$R" --single-transaction -c 'set session_replication_role = replica' -f data.sql

# 3. what a --no-privileges dump leaves out: grants, realtime membership, owner id (db/restore/post_restore.sql)
psql "$R" -v ON_ERROR_STOP=1 -v new_owner_uid="$(uuidgen | tr A-Z a-z)" -f "$REPO/db/restore/post_restore.sql"

# 4. checks: counts match the night's numbers, the ledger lists 0001..000N, and one read as the app's role
psql "$R" -c "select count(*) from os_tasks" -c "select filename from os_schema_migrations order by 1"
psql "$R" -c "select set_config('request.jwt.claims', json_build_object('sub', (select value #>> '{}' from os_settings where key='owner_uid'))::text, false)" \
          -c "set role authenticated" -c "select count(*) as tasks_the_owner_sees from os_tasks" \
          -c "select has_table_privilege('authenticated', 'os_schema_migrations', 'select') as must_be_false"
# the last query must say f, and the owner must see the same task count as step 4's first line.
# 5. cleanup: the trap above stops the container and removes $W (decrypted files) when the shell exits; do it now:
docker stop wos-restore; rm -rf "$W"; trap - EXIT
```

For a real recovery, run steps 2 and 3 against a NEW Supabase project (its roles and `auth` schema already exist,
so skip the shim), with `new_owner_uid` set to the owner's id in the NEW project's `auth.users`. Restoring the
data with `pg_restore --data-only` straight into the database is not enough: it leaves the grants, the realtime
membership and the owner id wrong (the app would show nothing). Then point `.env`, the GitHub secrets and
`/etc/workos/env` at it. Record each drill (date, run id, row counts) in `logs/`. Not yet checked: whether
`session_replication_role` can be set through the Supabase pooler; use the direct connection if it cannot.
