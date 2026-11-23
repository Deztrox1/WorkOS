#!/usr/bin/env bash
# Deploy the WorkOS web build to the Hostinger VPS as an atomic release (QA r1 infra I04, I05).
#   infra/deploy_web.sh              build app/, upload a new release, swap the symlink, verify, keep the last 5
#   infra/deploy_web.sh --no-build   skip the build, deploy DIST (default app/dist)
#   infra/deploy_web.sh --nginx      first (re)install infra/nginx/* on the VPS; a failed `nginx -t` restores the old files
#   infra/deploy_web.sh --allow-dirty  emergency only: deploy with uncommitted changes or an unpushed HEAD
#   infra/deploy_web.sh --dry-run    print the remote commands, run nothing on the VPS, build nothing
# Flags work in any order. Env: VPS (default root@203.0.113.10), SSH_KEY (default ~/.ssh/vps_deploy).
#
# Layout on the VPS: /var/www/workos-releases/<stamp>/ holds each release; /var/www/workos is a symlink to the
# live one, so the nginx root path never changes. The first run moves the old real directory into releases/.
set -euo pipefail
cd "$(dirname "$0")/.."
DIST="${DIST:-app/dist}"
VPS="${VPS:-root@203.0.113.10}"
KEY="${SSH_KEY:-$HOME/.ssh/vps_deploy}"
HOST="${WORKOS_HOST:-os.example.com}"
LIVE=/var/www/workos; REL=/var/www/workos-releases
SSH=(ssh -i "$KEY" -o BatchMode=yes)
BUILD=1; NGINX=0; DIRTY=0; DRY=0
for a in "$@"; do case "$a" in
  --no-build) BUILD=0;; --nginx) NGINX=1;; --allow-dirty) DIRTY=1;; --dry-run) DRY=1;;
  *) echo "unknown flag $a"; exit 2;; esac; done

# Run a script on the VPS (stdin), or print it in a dry run.
remote() { if [ "$DRY" = 1 ]; then echo "--- [dry-run] on $VPS:"; cat; echo "---"; else "${SSH[@]}" "$VPS" 'bash -s'; fi; }
copy() { if [ "$DRY" = 1 ]; then echo "[dry-run] copy $1 -> $VPS:$2"; else scp -q -i "$KEY" "$1" "$VPS:$2"; fi; }

# ---- 1. only ship what is committed and pushed (any tracked change, or an untracked file the build could pick up;
# untracked folders outside app/ and infra/ belong to other work and never reach the build)
if [ -n "$(git status --porcelain --untracked-files=no -- .)$(git status --porcelain -- app infra)" ]; then
  [ "$DIRTY" = 1 ] && echo "WARNING: deploying with uncommitted changes (--allow-dirty)" \
    || { echo "Refusing: uncommitted changes in $(pwd). Commit them, or pass --allow-dirty for an emergency."; exit 1; }
fi
git fetch -q origin main 2>/dev/null || echo "WARNING: could not fetch origin/main"
if ! git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then
  [ "$DIRTY" = 1 ] && echo "WARNING: HEAD is not on origin/main (--allow-dirty)" \
    || { echo "Refusing: HEAD is not on origin/main. Push first, or pass --allow-dirty."; exit 1; }
fi

if [ "$BUILD" = 1 ] && [ "$DRY" = 0 ] && [ -f app/package.json ]; then
  (cd app && { [ -d node_modules ] || npm ci; } && npm run build)
fi
[ -f "$DIST/index.html" ] || { [ "$DRY" = 1 ] && echo "(dry run: $DIST/index.html not built)" || { echo "$DIST/index.html missing, nothing to deploy"; exit 1; }; }

# ---- 2. nginx config (every site on the box shares this nginx, so a bad file must never stay)
if [ "$NGINX" = 1 ]; then
  S="/etc/nginx/sites-available/workos"; A="/etc/nginx/snippets/workos-app.conf"; H="/etc/nginx/snippets/workos-headers.conf"
  copy infra/nginx/workos-app.snippet "$A.new"
  copy infra/nginx/workos-headers.snippet "$H.new"
  copy infra/nginx/workos.conf "$S.new"
  remote <<EOS
set -eu
mkdir -p /etc/nginx/snippets $LIVE-acme
bak=/root/workos-nginx.bak-$(date +%Y%m%d-%H%M%S); mkdir -p "\$bak"
for f in $S $A $H; do [ -f "\$f" ] && cp -p "\$f" "\$bak/\$(basename "\$f")" || true; done
had_link=0; [ -L /etc/nginx/sites-enabled/workos ] && had_link=1
restore() {
  for f in $S $A $H; do
    if [ -f "\$bak/\$(basename "\$f")" ]; then cp -p "\$bak/\$(basename "\$f")" "\$f"; else rm -f "\$f"; fi
    rm -f "\$f.new"
  done
  [ "\$had_link" = 1 ] || rm -f /etc/nginx/sites-enabled/workos
  echo "nginx config restored from \$bak"
}
ok=0; trap '[ "\$ok" = 1 ] || restore' EXIT
for f in $S $A $H; do mv "\$f.new" "\$f"; done
ln -sfn $S /etc/nginx/sites-enabled/workos
nginx -t
ok=1
systemctl reload nginx
echo "nginx reloaded (backup in \$bak)"
EOS
fi

# ---- 3. upload a new release, then swap the symlink
STAMP=$(date +%Y%m%d-%H%M%S)
remote <<EOS
set -eu
mkdir -p $REL
if [ -d $LIVE ] && [ ! -L $LIVE ]; then          # first run: move the real directory aside, then link it
  mv $LIVE $REL/legacy-$STAMP && ln -s $REL/legacy-$STAMP $LIVE
fi
mkdir -p $REL/$STAMP
EOS
if [ "$DRY" = 1 ]; then
  echo "[dry-run] rsync -az --delete $DIST/ $VPS:$REL/$STAMP/"
else
  rsync -az --delete -e "ssh -i $KEY -o BatchMode=yes" "$DIST"/ "$VPS:$REL/$STAMP/"   # macOS rsync has no --chown
  "${SSH[@]}" "$VPS" "chown -R root:root $REL/$STAMP && chmod -R go-w $REL/$STAMP"
fi
PREV=$(if [ "$DRY" = 1 ]; then echo "<previous release>"; else "${SSH[@]}" "$VPS" "readlink -f $LIVE || true"; fi)
remote <<EOS
set -eu
nginx -t
ln -sfn $REL/$STAMP $LIVE.tmp && mv -T $LIVE.tmp $LIVE      # atomic rename over the symlink
echo "live -> \$(readlink $LIVE)"
EOS

# ---- 4. verify; point the symlink back at the previous release if it fails
rollback() {
  echo "VERIFY FAILED: $1. Restoring $PREV"
  [ -n "$PREV" ] && remote <<EOS
set -eu
ln -sfn $PREV $LIVE.tmp && mv -T $LIVE.tmp $LIVE
echo "live -> \$(readlink $LIVE)"
EOS
  exit 1
}
if [ "$DRY" = 1 ]; then
  echo "[dry-run] verify: / is 200, the JS file named in index.html is 200 with 'immutable', /sw.js is no-store, /robots.txt allows crawlers, X-Robots-Tag holds noindex; else restore the previous release"
elif [ -z "$(dig +short "$HOST")" ]; then
  echo "SKIP verify: no DNS for $HOST"
else
  code=$(curl -s -o /tmp/workos-index.$$ -w '%{http_code}' --max-time 15 "https://$HOST/?v=$STAMP" || true)
  [ "$code" = 200 ] || rollback "/ answered $code"
  js=$(grep -o '/assets/[^"]*\.js' /tmp/workos-index.$$ | head -1 || true); rm -f /tmp/workos-index.$$
  [ -n "$js" ] || rollback "index.html names no /assets/*.js file"
  hdr=$(curl -sI --max-time 15 "https://$HOST$js" || true)
  printf '%s' "$hdr" | head -1 | grep -q ' 200' || rollback "$js did not answer 200"
  printf '%s' "$hdr" | grep -qi '^cache-control:.*immutable' || rollback "$js has no immutable cache header"
  curl -sI --max-time 15 "https://$HOST/sw.js" | grep -qi '^cache-control:.*no-store' || rollback "/sw.js is not no-store"
  # Plan decision 12: crawlers are let in and read noindex. Both come from infra/nginx, so an old config fails here:
  # run this again with --nginx.
  robots=$(curl -s --max-time 15 "https://$HOST/robots.txt" || true)
  printf '%s\n' "$robots" | grep -qi '^allow: /$' || rollback "/robots.txt does not say Allow: / (old nginx config? use --nginx)"
  ! printf '%s\n' "$robots" | grep -qi '^disallow: */ *$' || rollback "/robots.txt still blocks crawlers (old nginx config? use --nginx)"
  curl -sI --max-time 15 "https://$HOST/" | grep -qi '^x-robots-tag:.*noindex' || rollback "/ has no noindex header (old nginx config? use --nginx)"
  echo "$HOST verified: / 200, $js 200 immutable, /sw.js no-store, robots.txt allows, noindex header on"
fi

# ---- 5. keep the last 5 releases (never the live one)
remote <<EOS
set -eu
cur=\$(readlink -f $LIVE)
ls -1dt $REL/* | tail -n +6 | while read -r d; do [ "\$(readlink -f "\$d")" = "\$cur" ] || rm -rf "\$d"; done
ls -1t $REL | head -5
EOS
