#!/usr/bin/env bash
# Install push-due, claude-fire and gcal-sync on the VPS as three systemd services + timers.
#   workos-push    push_due.py    reminders, habits, tasks, digest, alerts (Web Push)
#   workos-claude  claude_fire.py queued Ask Claude briefs -> the Claude Code routine (QA r1 D3: own unit,
#                  own timeout, so a slow POST can never kill a push run or the reverse)
#   workos-gcal    gcal_sync.py   tasks <-> the primary Google Calendar, every 2 minutes (logs/qa-r4-plan.md)
# All are oneshot (never overlap themselves), each with its own timeout, DynamicUser sandbox.
# Run from the Mac, from anywhere. Secrets travel over ssh stdin and are never printed.
#   VAPID_PRIVATE_FILE=/path/to/private.txt execution/push/install_vps.sh      first install (writes /etc/workos/env)
#   ... --set-claude trig_xxx                                                   link the routine (writes /etc/workos/claude.env only)
#   execution/push/install_vps.sh                                               code update only (env file untouched)
#   ... --force-env                                                             rewrite /etc/workos/env
#   python3 execution/push/gcal_link.py                                         link Google Calendar (writes /etc/workos/gcal.env only)
# SUPABASE_DB_URL is read from $SUPABASE_DB_URL or "WF - WorkOS/.env" only (never Cold Email's .env: that is a
# different Supabase project), and must name the WorkOS project ref. VAPID public key: infra/vapid_public.txt.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VPS="${VPS:-root@203.0.113.10}"
KEY="${SSH_KEY:-$HOME/.ssh/vps_deploy}"
SSH=(ssh -i "$KEY" -o BatchMode=yes)
PROJECT_REF="${WORKOS_PROJECT_REF:-yourprojectref}"
# Flags work in any position (QA r1 I08): --force-env, --set-claude TRIG_ID.
FORCE=0; SETCLAUDE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --force-env) FORCE=1;;
    --set-claude) SETCLAUDE="${2:?usage: install_vps.sh --set-claude trig_xxx  (then paste the token and press Enter)}"; shift;;
    *) echo "unknown flag $1" >&2; exit 2;;
  esac; shift
done
# Secrets are split by unit (QA r2 S13): /etc/workos/env (DB URL, VAPID) is read by both units; the routine
# token lives only in /etc/workos/claude.env, which only the claude unit reads. The push unit talks to
# endpoints a browser registered, so it must never be able to read the token.
# --set-claude TRIG_ID: writes CLAUDE_ROUTINE_ID + CLAUDE_ROUTINE_TOKEN (token read from stdin) to claude.env
# only, and adds CLAUDE_FIRE_BUDGET=20 there when it has none (the daily cap; default 20, ceiling 50).
# The Google token lives only in /etc/workos/gcal.env, which only the gcal unit reads; until gcal_link.py has written it
# that unit starts anyway and only records that the calendar is not linked.
if [ -n "$SETCLAUDE" ]; then
  RID="$SETCLAUDE"
  read -r -s -p "Routine token (sk-ant-oat01-...): " TOK; echo
  printf 'CLAUDE_ROUTINE_ID=%s\nCLAUDE_ROUTINE_TOKEN=%s\n' "$RID" "$TOK" | "${SSH[@]}" "$VPS" \
    'umask 077; touch /etc/workos/claude.env; grep -v "^CLAUDE_ROUTINE_" /etc/workos/claude.env > /etc/workos/claude.env.new || true; cat >> /etc/workos/claude.env.new
     grep -q "^CLAUDE_FIRE_BUDGET=" /etc/workos/claude.env.new || echo "CLAUDE_FIRE_BUDGET=20" >> /etc/workos/claude.env.new
     mv /etc/workos/claude.env.new /etc/workos/claude.env; chmod 600 /etc/workos/claude.env'
  echo "routine link written to /etc/workos/claude.env (root, 0600); /etc/workos/env untouched"; exit 0
fi

STAMP=$(date +%Y%m%d-%H%M%S)
BAK="/root/workos-units.bak-$STAMP"
"${SSH[@]}" "$VPS" "mkdir -p /opt/workos/push/shared /etc/workos && chmod 700 /etc/workos
  mkdir -p $BAK && cp -a /etc/systemd/system/workos-* $BAK/ 2>/dev/null; cp -a /opt/workos/push $BAK/push 2>/dev/null; true"
# Files must be root-owned (the Mac uid used to leak through and the services execute these). macOS rsync has no
# --chown, so ownership is fixed by the chown -R right after the copy.
RS=(rsync -az -e "ssh -i $KEY -o BatchMode=yes")
"${RS[@]}" "$ROOT/execution/push/push_due.py" "$ROOT/execution/push/claude_fire.py" "$ROOT/execution/push/gcal_sync.py" "$VPS:/opt/workos/push/"
"${RS[@]}" "$ROOT/execution/requirements.txt" "$VPS:/opt/workos/requirements.txt"
"${RS[@]}" "$ROOT/shared/next_fire.py" "$VPS:/opt/workos/push/shared/"
"${SSH[@]}" "$VPS" "chown -R root:root /opt/workos/push /opt/workos/requirements.txt; chmod -R go-w /opt/workos/push"

# Put the saved scripts and units back (QA r3 R3D01): used when pip or the unit check fails after the copy.
restore_old() {
  echo "restoring the scripts and units saved in $BAK" >&2
  "${SSH[@]}" "$VPS" "if [ -d $BAK/push ]; then rm -rf /opt/workos/push && cp -a $BAK/push /opt/workos/push; fi
    for u in workos-gcal.service workos-gcal.timer; do [ -e $BAK/\$u ] || rm -f /etc/systemd/system/\$u; done
    cp -a $BAK/workos-* /etc/systemd/system/ 2>/dev/null; systemctl daemon-reload; true"
}
"${SSH[@]}" "$VPS" 'test -x /opt/workos/venv/bin/python || python3 -m venv /opt/workos/venv
  /opt/workos/venv/bin/pip install -q --require-hashes -r /opt/workos/requirements.txt' || { restore_old; exit 1; }

have_env=$("${SSH[@]}" "$VPS" 'test -s /etc/workos/env && echo yes || echo no')
if [ "$have_env" = no ] || [ "$FORCE" = 1 ]; then
  DB="${SUPABASE_DB_URL:-$(grep '^SUPABASE_DB_URL=' "$ROOT/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d "'\"")}"
  [ -n "$DB" ] || { echo "No SUPABASE_DB_URL in the environment or $ROOT/.env. Nothing written." >&2; exit 1; }
  # The ref must appear in the host or the pooler user name, not just anywhere (the password is cut off first).
  case "$(printf '%s' "$DB" | sed -E 's#(://[^:/]+):[^@]*@#\1@#')" in
    *"$PROJECT_REF"*) ;;
    *) echo "SUPABASE_DB_URL does not name project $PROJECT_REF. Nothing written." >&2; exit 1 ;;
  esac
  PRIV="$(cat "${VAPID_PRIVATE_FILE:?set VAPID_PRIVATE_FILE for the first install}")"
  PUB="$(tr -d '\n' < "$ROOT/infra/vapid_public.txt")"
  printf 'SUPABASE_DB_URL=%s\nVAPID_PRIVATE_KEY=%s\nVAPID_PUBLIC_KEY=%s\nVAPID_SUBJECT=mailto:alex@example.com\n' \
    "$DB" "$PRIV" "$PUB" | "${SSH[@]}" "$VPS" 'umask 077; cat > /etc/workos/env; chmod 600 /etc/workos/env'
  echo "wrote /etc/workos/env (root, 0600)"
fi

# Move any CLAUDE_* lines an older install left in /etc/workos/env into claude.env (key names only are printed).
"${SSH[@]}" "$VPS" 'umask 077; if grep -q "^CLAUDE_" /etc/workos/env 2>/dev/null; then
    touch /etc/workos/claude.env
    for k in $(grep "^CLAUDE_" /etc/workos/env | cut -d= -f1); do
      grep -v "^$k=" /etc/workos/claude.env > /etc/workos/claude.env.new || true
      grep "^$k=" /etc/workos/env >> /etc/workos/claude.env.new
      mv /etc/workos/claude.env.new /etc/workos/claude.env; echo "moved $k to claude.env"
    done
    grep -v "^CLAUDE_" /etc/workos/env > /etc/workos/env.new; mv /etc/workos/env.new /etc/workos/env; chmod 600 /etc/workos/env
    chmod 600 /etc/workos/claude.env
  fi'

HARDEN='DynamicUser=yes
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=yes
ProtectSystem=strict
ProtectHome=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_INET AF_INET6
RestrictRealtime=yes
LockPersonality=yes
SystemCallArchitectures=native
CapabilityBoundingSet='
# name | description | script | extra EnvironmentFile ("-" prefix: optional, unit starts without it) | timeout seconds | every
# The push unit gets 50 s so a hung database call cannot make reminders wait 5 minutes (QA r1 I07).
for spec in "push|WorkOS push-due (send due reminders, habits, tasks, alerts)|push_due.py||50|1min" \
            "claude|WorkOS claude-fire (hand queued Ask Claude briefs to the routine)|claude_fire.py|-/etc/workos/claude.env|300|1min" \
            "gcal|WorkOS gcal-sync (tasks and the primary Google Calendar, both ways)|gcal_sync.py|-/etc/workos/gcal.env|120|2min"; do
  IFS='|' read -r NAME DESC SCRIPT EXTRA TMO EVERY <<<"$spec"
  ENVLINES=("EnvironmentFile=/etc/workos/env"); [ -z "$EXTRA" ] || ENVLINES+=("EnvironmentFile=$EXTRA")
  printf '%s\n' "[Unit]" "Description=$DESC" "After=network-online.target" "Wants=network-online.target" "" \
    "[Service]" "Type=oneshot" "${ENVLINES[@]}" \
    "ExecStart=/opt/workos/venv/bin/python /opt/workos/push/$SCRIPT" "TimeoutStartSec=$TMO" "MemoryMax=256M" "$HARDEN" \
    | "${SSH[@]}" "$VPS" "cat > /etc/systemd/system/workos-$NAME.service"
  printf '%s\n' "[Unit]" "Description=Run workos-$NAME every $EVERY" "" "[Timer]" "OnBootSec=1min" \
    "OnUnitActiveSec=$EVERY" "AccuracySec=1s" "" "[Install]" "WantedBy=timers.target" \
    | "${SSH[@]}" "$VPS" "cat > /etc/systemd/system/workos-$NAME.timer"
done
# Verify the new units before systemd sees them; on any complaint put the old ones back.
if ! "${SSH[@]}" "$VPS" 'systemd-analyze verify /etc/systemd/system/workos-push.service /etc/systemd/system/workos-claude.service /etc/systemd/system/workos-gcal.service /etc/systemd/system/workos-push.timer /etc/systemd/system/workos-claude.timer /etc/systemd/system/workos-gcal.timer'; then
  echo "systemd-analyze verify failed" >&2
  restore_old
  exit 1
fi
"${SSH[@]}" "$VPS" 'systemctl daemon-reload && systemctl enable --now workos-push.timer workos-claude.timer workos-gcal.timer'
# A oneshot start waits for the run and fails with it. Everything still prints; the exit code comes at the end (R4B14).
GCAL_OK=1
"${SSH[@]}" "$VPS" 'systemctl start workos-gcal.service' || GCAL_OK=0
"${SSH[@]}" "$VPS" 'systemctl start workos-push.service workos-claude.service; systemctl is-active workos-push.timer workos-claude.timer workos-gcal.timer
  journalctl -u workos-push.service -n 3 --no-pager -o cat; journalctl -u workos-claude.service -n 3 --no-pager -o cat; journalctl -u workos-gcal.service -n 3 --no-pager -o cat'

echo "--- modes (owner mode path)"
"${SSH[@]}" "$VPS" 'stat -c "%a %U:%G %n" /etc/workos /etc/workos/* /opt/workos/push /opt/workos/push/*.py /opt/workos/requirements.txt /etc/systemd/system/workos-*'
echo "old units and scripts saved in $BAK"
if [ "$GCAL_OK" = 0 ]; then
  echo "workos-gcal failed its first run. Is migration 0010 applied? See: journalctl -u workos-gcal -n 20" >&2
  exit 1
fi
