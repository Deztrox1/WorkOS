#!/usr/bin/env python3
"""Link WorkOS to the owner's Google Calendar. Run once on the Mac by the owner, and again if the app says
"Google Calendar needs you to sign in again."

What it does:
  1. One browser consent with gws's own client_secret.json (or --client-file), scope ONLY calendar.events (never the broad
     gws token). Loopback redirect on 127.0.0.1, PKCE, state check. The same flow as scripts/repair-google-modal-token.py.
  2. Proves the new refresh token works: a token refresh, then one event listed from primary (the event is not shown).
     Refuses any calendar but ACCOUNT's: login_hint is only a hint, and the wrong account would look like every event deleted.
  3. Writes GCAL_CLIENT_ID, GCAL_CLIENT_SECRET, GCAL_REFRESH_TOKEN and GCAL_ACCOUNT over ssh stdin to /etc/workos/gcal.env
     (0600), which only the workos-gcal unit reads. Nothing secret is printed, and nothing is written to this Mac.

This script must NEVER revoke anything. This token shares its OAuth client with the gws CLI and the Modal secret
`acme-google`, and revoking any one token of that client kills the shared grant: gws stops working and every lead form
fails with invalid_grant. To unlink, delete /etc/workos/gcal.env and leave the token alone.

Usage:  python3 execution/push/gcal_link.py [--wait-minutes 30] [--no-open] [--client-file PATH]
Sign in as alex@example.com. VPS and SSH_KEY work as in install_vps.sh. --client-file names an OAuth client of Personal
OS's own, so its token can one day be revoked without touching gws or the lead forms.
"""
import argparse, base64, hashlib, http.server, json, os, secrets, subprocess, sys, threading, urllib.error, urllib.parse, urllib.request

CLIENT_FILE = os.path.expanduser("~/.config/gws/client_secret.json")
ACCOUNT = "alex@example.com"
SCOPE = "https://www.googleapis.com/auth/calendar.events"
AUTH_URI = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URI = "https://oauth2.googleapis.com/token"
EVENTS_URI = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
VPS = os.environ.get("VPS", "root@203.0.113.10")
KEY = os.environ.get("SSH_KEY", os.path.expanduser("~/.ssh/vps_deploy"))
REMOTE_WRITE = ("umask 077 && mkdir -p /etc/workos && cat > /etc/workos/gcal.env.new && chmod 600 /etc/workos/gcal.env.new && "
                "mv /etc/workos/gcal.env.new /etc/workos/gcal.env")


def auth_url(client_id, redirect, challenge, state):
    return AUTH_URI + "?" + urllib.parse.urlencode({
        "client_id": client_id, "redirect_uri": redirect, "response_type": "code", "scope": SCOPE,
        "access_type": "offline", "prompt": "consent", "include_granted_scopes": "false",
        "code_challenge": challenge, "code_challenge_method": "S256", "state": state,
        "login_hint": ACCOUNT,
    })


def env_text(client_id, client_secret, refresh_token, account=ACCOUNT):
    values = {"GCAL_CLIENT_ID": client_id, "GCAL_CLIENT_SECRET": client_secret, "GCAL_REFRESH_TOKEN": refresh_token,
              "GCAL_ACCOUNT": account}
    if any(not v or any(c.isspace() for c in v) for v in values.values()):
        sys.exit("Google sent something unexpected. Nothing was changed.")
    return "".join(f"{k}={v}\n" for k, v in values.items())


def post(url, data):
    req = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode(), method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.load(e)


def calendar_account(access_token):
    """Whose calendar this token opens: a primary calendar's summary is its owner's address. None when it cannot list."""
    q = urllib.parse.urlencode({"maxResults": 1, "singleEvents": "true", "fields": "kind,summary"})
    req = urllib.request.Request(f"{EVENTS_URI}?{q}", headers={"Authorization": f"Bearer {access_token}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            reply = json.load(r)
    except urllib.error.HTTPError:
        return None
    return reply.get("summary") if reply.get("kind") == "calendar#events" else None


def check_account(found):
    if found is None:
        sys.exit("The new sign in cannot read the calendar. Nothing was changed.")
    if found != ACCOUNT:
        sys.exit(f"That is not the calendar of {ACCOUNT}. Sign in with that account and run this again. If you did, the calendar "
                 f"was renamed in Google Calendar settings: change its name back to {ACCOUNT}. Nothing was changed.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wait-minutes", type=int, default=30)
    ap.add_argument("--no-open", action="store_true")
    ap.add_argument("--client-file", default=CLIENT_FILE)
    a = ap.parse_args()

    with open(os.path.expanduser(a.client_file)) as f:
        c = json.load(f)
    c = c.get("installed") or c.get("web")
    cid, csec = c["client_id"], c["client_secret"]

    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(24)
    got = {}
    done = threading.Event()

    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
            if "code" not in q and "error" not in q:
                self.send_response(404); self.end_headers(); return
            got.update(q)
            self.send_response(200); self.send_header("Content-Type", "text/plain"); self.end_headers()
            self.wfile.write(b"Done. You can close this tab and go back to the terminal.")
            done.set()

        def log_message(self, *args):
            pass

    srv = http.server.HTTPServer(("127.0.0.1", 0), H)
    redirect = f"http://127.0.0.1:{srv.server_port}/"
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = auth_url(cid, redirect, challenge, state)
    print(f"Open this URL, sign in as {ACCOUNT} and press Allow:\n" + url, flush=True)
    if not a.no_open:
        subprocess.run(["open", url], check=False)
    if not done.wait(a.wait_minutes * 60):
        sys.exit(f"No answer within {a.wait_minutes} minutes. Nothing was changed. Run this again.")
    srv.shutdown()

    if got.get("state") != state:
        sys.exit("The answer did not match this run. Nothing was changed.")
    if "error" in got:
        sys.exit(f"Google said {got['error']}. Nothing was changed.")

    st, tok = post(TOKEN_URI, {"grant_type": "authorization_code", "code": got["code"], "client_id": cid,
                               "client_secret": csec, "redirect_uri": redirect, "code_verifier": verifier})
    rt = tok.get("refresh_token")
    if st != 200 or not rt:
        sys.exit(f"Google did not finish the sign in ({st}: {tok.get('error')}). Nothing was changed.")
    if set(tok.get("scope", "").split()) != {SCOPE}:
        sys.exit("Google gave different access than asked for, so this was not saved. Nothing was changed.")

    st, chk = post(TOKEN_URI, {"grant_type": "refresh_token", "refresh_token": rt, "client_id": cid, "client_secret": csec})
    if st != 200:
        sys.exit(f"The new sign in does not work ({chk.get('error')}). Nothing was changed.")
    check_account(calendar_account(chk["access_token"]))

    r = subprocess.run(["ssh", "-i", KEY, "-o", "BatchMode=yes", VPS, REMOTE_WRITE], input=env_text(cid, csec, rt),
                       capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"Could not reach the server (ssh exit {r.returncode}). Nothing was changed there. Run this again.")
    print("Google Calendar is linked. Your tasks will show on it within a few minutes.")


if __name__ == "__main__":
    main()
