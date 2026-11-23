#!/usr/bin/env python3
"""
gcal_sync: keep the owner's primary Google Calendar and the scheduled tasks in step, both ways (logs/qa-r4-plan.md).
Runs as its own systemd unit on the VPS (workos-gcal.timer, every 2 minutes; execution/push/install_vps.sh).

One run, in order. One at a time (advisory lock). Every step commits item by item, so a killed run loses at most one.
  1. No credentials: the mirror empties, state linked=false, nothing else. Refresh the access token. invalid_grant,
     invalid_client or unauthorized_client: state.problem, one `bad` event per IST day, exit 0 (no error loop).
  2. List today-1 to today+30 IST, all pages. The list must come from GCAL_ACCOUNT's calendar, or the run stops there and
     changes nothing. The mirror keeps today-1 to today+3 of it: upsert, then delete the rest, only after a complete list.
     Skipped: workingLocation, and anything the owner declined. Someone else's event the owner has not said yes or maybe to
     is kept as Free with no Join link.
     Kept per event: title, times, busy and the two links. Never the description, the attendees or the location.
     A list that worked means the link works: linked=true from here on, whatever one item does.
  3. Rebuild a link lost in a crash: an event with our fixed id and workos_task, for a task that still has a time.
  4. Each link, three signatures (stored, task now, event now). The stored one and the task's are
     title|YYYY-MM-DD|HH:MM|minutes in IST. The event's is the last three only: the title belongs to the app, so a rename
     in Google is not pulled, never compared and never undone. No Google text reaches a task or a brief.
       task done                               -> left alone
       event has other guests or a repeat rule -> no longer ours: link released, event left alone, task kept as it is
       task gone, dropped, or no date and time -> DELETE the event (404/410 is fine), remove the link
       only the task changed                   -> PATCH the event (the title only when the task's title changed)
       only the event moved                    -> task follows (guarded on updated_at), planned_for with it when it was
                                                  set, pushed_at null only when the moment changed and is still ahead
       both moved                              -> newest wins (task.updated_at against event.updated)
       event moved to all day                  -> due_date follows, due_time cleared, link removed, event left in place
       cancelled or 404/410 by a direct GET    -> task stays, due_time cleared, link removed, info event. Never by absence
                                                  from a list.
     A link the list does not hold costs a GET, so one is read at most once an hour unless its task changed.
  5. Create: open tasks with due_date >= today IST, a due_time and no link. The id is fixed from the task id, so a retry
     finds the same event (409 -> GET -> PATCH -> link).

Caps. At most MAX_WRITES Google writes a run; the rest wait for the next run. Per IST day, counted in os_calendar_state: at
most MAX_WRITES_DAY Google writes and MAX_CLEARS tasks losing their time (clears and all-day moves together, each one's old
date and time kept in its event body so it can be put back). Past a cap the rest wait for the next IST day, one `bad` event
says so, and the problem line stays until the count resets. Moves have no cap, but each one keeps its old date and time too.

An item Google refuses, or a row that cannot be handled, is skipped and named on the problem line; the run still counts as
good. Creates run in random order, so tasks Google keeps refusing cannot use up every run's writes. A task refused for
GIVE_UP_AFTER is tried once a day after that, or at once when it changes (os_settings key gcal_refused).
A date no one could mean (infinity, year 10000) is read as null with dates_ok false, so it is skipped too and its
event left alone. An updated_at no one could mean reads as null and blocks nothing. Any other failure: state.problem, last_ok_at and every row kept, one `warn` event per IST day. A failed
run never deletes or clears anything. Only events in os_calendar_links are ever deleted, and only links this file made exist.

Event titles are untrusted data: anyone can send an invite. Parameterised SQL only. No token and no full response is
ever printed.

Env: SUPABASE_DB_URL (/etc/workos/env), GCAL_CLIENT_ID, GCAL_CLIENT_SECRET, GCAL_REFRESH_TOKEN, GCAL_ACCOUNT
(/etc/workos/gcal.env, read only by this unit, written by gcal_link.py). Scope: calendar.events only.
Flags: --dry-run (reads Google, prints what would change, writes nothing), --now ISO.
"""
import argparse
import json
import os
import random
import re
import sys
import uuid
from datetime import date, datetime, timedelta, timezone
from urllib.parse import quote
from zoneinfo import ZoneInfo

TOKEN_URL = "https://oauth2.googleapis.com/token"
EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
TIMEOUT = (10, 30)           # (connect, read) seconds
MAX_WRITES = 50              # Google writes a run
MAX_WRITES_DAY = 200         # Google writes per IST day; normal use is under 30
MAX_CLEARS = 10              # tasks per IST day that may lose their time because the event went away or went all day
MAX_SINGLE_READS = 100       # GETs a run for links outside the list; links are walked in random order
REREAD_AFTER = timedelta(hours=1)
GIVE_UP_AFTER = timedelta(days=3)    # a task Google keeps refusing: every run until then, once a day after
RETRY_EVERY = timedelta(days=1)
MAX_PAGES = 40               # 2,500 events a page
MIRROR_DAYS_AHEAD = 3
TITLE_MAX = 500
NAME_MAX = 60                # a task title on the problem line
DEFAULT_MINUTES = 30
EVENT_PREFIX = "pos"         # Google allows only a-v and 0-9 in an id, so never a "w"
TZ_NAME = "Asia/Kolkata"
SOURCE = "calendar"
LOCK_KEY = "os_gcal_sync"
STUCK_KEY = "gcal_refused"   # os_settings: {task id: {sig, since, tried}}. Each run is a new process, so the memory lives here
IST = timezone(timedelta(hours=5, minutes=30), "IST")
HTML_LINK = re.compile(r"^https://www\.google\.com/calendar/")     # the same two checks as migration 0010
MEET_LINK = re.compile(r"^https://meet\.google\.com/[a-z]{3}-[a-z]{4}-[a-z]{3}(\?[a-z0-9=&_-]*)?$")
LIST_FIELDS = ("kind,summary,nextPageToken,items(id,status,eventType,summary,start,end,transparency,updated,htmlLink,hangoutLink,"
               "organizer(self),attendees(self,responseStatus),extendedProperties)")
GET_FIELDS = "id,status,summary,start,end,updated,extendedProperties,attendees(self,responseStatus),recurrence"
SIGN_IN_ERRORS = ("invalid_grant", "invalid_client", "unauthorized_client")

PROBLEM_SIGN_IN = "Google Calendar needs you to sign in again."
SIGN_IN_BODY = "On the Mac, run gcal_link.py and press Allow. Until then, your tasks and your calendar will not match."
PROBLEM_DOWN = "Google Calendar could not be reached. It will try again by itself."
PROBLEM_STOPPED = "The calendar check stopped partway. It will try again by itself."
PROBLEM_WRONG_ACCOUNT = ("Google Calendar is linked to the wrong account, or the calendar was renamed in Google Calendar settings, "
                         "so nothing was changed.")
WRONG_ACCOUNT_BODY = ("If it was renamed, change its name back to your email address. If not, on the Mac, run gcal_link.py and "
                      "sign in with the right account.")
REFUSED_EVENT = "Google Calendar refused a change."
PROBLEM_TOO_MANY_GONE = f"{MAX_CLEARS} calendar events went away or changed today. Other tasks stay as they are until tomorrow."
TOO_MANY_GONE_BODY = "Open Activity to see each task with its old date and time."
PROBLEM_TOO_MANY_WRITES = f"The app made {MAX_WRITES_DAY} changes on Google Calendar today. The rest wait until tomorrow."
TOO_MANY_WRITES_BODY = "They go on by themselves tomorrow."


class SignInNeeded(Exception):
    """The refresh token no longer works. Only the owner can fix it."""


class GoogleDown(Exception):
    """Google or the network failed: stop this run. Carries a status code at most, never a response."""


class WrongAccount(Exception):
    """The list came from a calendar other than GCAL_ACCOUNT's. Nothing may be read as missing or written there."""


class ItemRefused(Exception):
    """Google said no to this one item: skip it and carry on, so one bad item cannot block the rest."""


# --------------------------------------------------------------- pure decisions (unit-tested)
def clean(text) -> str:
    """Text Postgres will store: no NUL, nothing that cannot be UTF-8. A title is untrusted and must not stop a run."""
    return str(text or "").replace("\x00", "").encode("utf-8", "ignore").decode("utf-8")


def norm_title(text) -> str:
    """One line, capped. Used for what we send, what we store and what we compare, so all three agree."""
    return " ".join(clean(text).split())[:TITLE_MAX].rstrip()


def fixed_id(task_id) -> str:
    return EVENT_PREFIX + str(task_id).replace("-", "").lower()


def task_minutes(t) -> int:
    return t["est_minutes"] or DEFAULT_MINUTES


def task_when(t):
    """date|time|minutes, or None when the task has no date and time."""
    if not t["due_date"] or t["due_time"] is None:
        return None
    return f"{t['due_date'].isoformat()}|{t['due_time']:%H:%M}|{task_minutes(t)}"


def task_sig(t):
    """None when the task has no date and time."""
    when = task_when(t)
    return when and f"{norm_title(t['title'])}|{when}"


def split_sig(sig):
    """(title, date|time|minutes) of a stored signature. A title can hold a | itself."""
    title, *when = sig.rsplit("|", 3)
    return title, "|".join(when)


def _instant(side):
    """A Google dateTime as an aware datetime. Google sends an offset; without one the side's timeZone decides."""
    d = datetime.fromisoformat(side["dateTime"].replace("Z", "+00:00"))
    if d.tzinfo is None:
        try:
            d = d.replace(tzinfo=ZoneInfo(side.get("timeZone") or TZ_NAME))
        except (KeyError, ValueError):
            d = d.replace(tzinfo=IST)
    return d


def parse_when(e):
    """{starts_at, ends_at, all_day_from, all_day_to} or None when the event's times cannot be read."""
    start, end = e.get("start") or {}, e.get("end") or {}
    try:
        if start.get("dateTime") and end.get("dateTime"):
            return {"starts_at": _instant(start), "ends_at": _instant(end), "all_day_from": None, "all_day_to": None}
        if start.get("date") and end.get("date"):
            return {"starts_at": None, "ends_at": None, "all_day_from": date.fromisoformat(start["date"]),
                    "all_day_to": date.fromisoformat(end["date"])}
    except (TypeError, ValueError, AttributeError):
        return None
    return None


def event_minutes(when) -> int:
    n = int((when["ends_at"] - when["starts_at"]).total_seconds() // 60)
    return n if n > 0 else DEFAULT_MINUTES


def event_sig(when):
    """date|time|minutes, None for an all-day event. Never the title: that is Google text and it belongs to no task."""
    if not when["starts_at"]:
        return None
    local = when["starts_at"].astimezone(IST)
    return f"{local.date().isoformat()}|{local:%H:%M}|{event_minutes(when)}"


def skip_event(e) -> bool:
    if e.get("status") == "cancelled" or e.get("eventType") == "workingLocation":
        return True
    return any(a.get("self") and a.get("responseStatus") == "declined" for a in e.get("attendees") or [])


def unanswered(e) -> bool:
    """Still waiting on the owner, or someone else's event with no yes or maybe from the owner. An invite sent to a group or
    an alias has no attendee marked self at all. Google leaves self out when it is false, so a missing organizer means
    someone else's event."""
    answers = [a.get("responseStatus") for a in e.get("attendees") or [] if a.get("self")]
    if "needsAction" in answers:
        return True
    return not ((e.get("organizer") or {}).get("self") or "accepted" in answers or "tentative" in answers)


def unmanaged(e) -> bool:
    """Other guests or a repeat rule: moving, renaming or deleting this event would reach other people or a whole series."""
    return bool(e.get("recurrence")) or any(not a.get("self") for a in e.get("attendees") or [])


def safe_link(url, rx):
    return url if isinstance(url, str) and rx.match(url) else None


def mirror_row(e):
    """The row the mirror keeps for one listed event, or None when it is not kept."""
    if not isinstance(e.get("id"), str) or not e["id"] or skip_event(e):
        return None
    when = parse_when(e)
    if not when:
        return None
    iso = lambda v: v.isoformat() if v else None    # noqa: E731
    stranger = unanswered(e)         # anyone can send an invite: it must not take the top of the day or the Join button
    return {"id": clean(e["id"]), "title": norm_title(e.get("summary")),
            "busy": e.get("transparency") != "transparent" and not stranger,
            "html_link": safe_link(e.get("htmlLink"), HTML_LINK),
            "meet_link": None if stranger else safe_link(e.get("hangoutLink"), MEET_LINK),
            **{k: iso(v) for k, v in when.items()}}


def event_task_id(e):
    """The task id an event says it is the copy of, or None. Only trusted when the event also has that task's fixed id:
    a copy made in Google can carry the property under another id, and a repeat's instances do too."""
    v = (((e.get("extendedProperties") or {}).get("private")) or {}).get("workos_task")
    try:
        tid = str(uuid.UUID(str(v)))
    except (ValueError, AttributeError, TypeError):
        return None
    return tid if e.get("id") == fixed_id(tid) else None


def task_side(t):
    """What the task alone decides: 'delete', 'leave', or None (the event must be looked at)."""
    if t is None or t["status"] == "dropped":
        return "delete"
    if t["status"] == "done":
        return "leave"
    return "delete" if task_sig(t) is None else None


def event_side(t, e, stored):
    """clear | all_day | pull | push | store | none. `e` is None only after a direct GET said 404 or 410."""
    if e is None or e.get("status") == "cancelled":
        return "clear"
    when = parse_when(e)
    if not when:
        return "none"                # times we cannot read are never a reason to change a task
    title, agreed = split_sig(stored)
    twhen, esig = task_when(t), event_sig(when)
    retitled = norm_title(t["title"]) != title
    task_moved, event_moved = twhen != agreed, esig != agreed
    if twhen == esig:                # nothing moved, or a crash between the write and the sig, or both made the same move
        return "push" if retitled else "none" if not task_moved else "store"
    if task_moved and event_moved:
        follow_event = _event_is_newer(t, e)
    else:
        follow_event = event_moved
    if not follow_event:
        return "push"
    return "all_day" if esig is None else "pull"


def _event_is_newer(t, e) -> bool:
    try:
        return datetime.fromisoformat(e["updated"].replace("Z", "+00:00")) > t["updated_at"]
    except (KeyError, TypeError, ValueError, AttributeError):
        return False


def event_times(t, was_all_day=False):
    """start and end for a task, in IST. Turning an all-day event back into a timed one needs date cleared explicitly."""
    start = datetime.combine(t["due_date"], t["due_time"], IST).replace(second=0, microsecond=0)
    out = {}
    for key, moment in (("start", start), ("end", start + timedelta(minutes=task_minutes(t)))):
        out[key] = {"dateTime": moment.isoformat(), "timeZone": TZ_NAME}
        if was_all_day:
            out[key]["date"] = None
    return out


def new_event(t):
    return {"id": fixed_id(t["id"]), "summary": norm_title(t["title"]), "description": "From WorkOS",
            **event_times(t), "reminders": {"useDefault": False},       # the app already alerts
            "extendedProperties": {"private": {"workos_task": str(t["id"])}}}


def _ist_midnight(d):
    return datetime(d.year, d.month, d.day, tzinfo=IST)


def window(now):
    """The list window as RFC 3339: the start of yesterday to the end of today+30, IST."""
    day = now.astimezone(IST).date()
    return _ist_midnight(day - timedelta(days=1)).isoformat(), _ist_midnight(day + timedelta(days=31)).isoformat()


def in_mirror(when, now) -> bool:
    """Does this event touch today-1 to today+3 IST? The app shows no further, so the database keeps no further."""
    day = now.astimezone(IST).date()
    first, past = day - timedelta(days=1), day + timedelta(days=MIRROR_DAYS_AHEAD + 1)
    if when["starts_at"]:
        return when["starts_at"] < _ist_midnight(past) and when["ends_at"] >= _ist_midnight(first)
    return when["all_day_from"] < past and when["all_day_to"] > first


def named_line(refused, odd_dates):
    """The problem line for tasks skipped this run, or None. Titles here are the owner's own, never Google's."""
    def who(titles):
        more = f" and {len(titles) - 1} more" if len(titles) > 1 else ""
        return f'"{min(titles)[:NAME_MAX].rstrip()}"{more}'      # min: creates run in random order, the line must not flicker
    if refused:
        return f"Google Calendar refused {who(refused)}. It will try again by itself."
    if odd_dates:
        return f"The date on {who(odd_dates)} cannot go on Google Calendar. Change it and the task will go on."
    return None


def was_on(t) -> str:
    """The old date and time, in words, so a cleared task can be put back by hand."""
    return f"It was on {t['due_date'].day} {t['due_date']:%b %Y} at {t['due_time']:%H:%M}."


def ist_day_start(now):
    d = now.astimezone(IST).date()
    return datetime(d.year, d.month, d.day, tzinfo=IST).astimezone(timezone.utc)


# --------------------------------------------------------------- Google
def http_call(method, url, *, headers=None, params=None, body=None, form=None):
    """(status, dict). Any network error is GoogleDown, with nothing of the request in it."""
    import requests
    try:
        r = requests.request(method, url, headers=headers, params=params, json=body, data=form, timeout=TIMEOUT)
    except requests.RequestException:
        raise GoogleDown("no connection") from None
    try:
        data = r.json()
    except ValueError:
        data = {}
    return r.status_code, data if isinstance(data, dict) else {}


def _rate_limited(data) -> bool:
    err = data.get("error")
    reasons = [x.get("reason") for x in err.get("errors") or [] if isinstance(x, dict)] if isinstance(err, dict) else []
    return any(r in ("rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded") for r in reasons)


class Google:
    def __init__(self, http, client_id, client_secret, refresh_token, account):
        self.http, self.creds, self.account, self.access = http, (client_id, client_secret, refresh_token), account, None

    def sign_in(self):
        cid, secret, refresh = self.creds
        status, data = self.http("POST", TOKEN_URL, form={"grant_type": "refresh_token", "client_id": cid,
                                                          "client_secret": secret, "refresh_token": refresh})
        if status == 200 and data.get("access_token"):
            self.access = data["access_token"]
        elif data.get("error") in SIGN_IN_ERRORS:
            raise SignInNeeded()
        else:
            raise GoogleDown(status)

    def _api(self, method, event_id=None, *, params=None, body=None, ok=()):
        url = EVENTS_URL if event_id is None else f"{EVENTS_URL}/{quote(event_id, safe='')}"
        status, data = self.http(method, url, headers={"Authorization": f"Bearer {self.access}"}, params=params, body=body)
        if 200 <= status < 300:
            return data
        if status in ok:
            return None
        if status in (401, 429) or status >= 500 or (status == 403 and _rate_limited(data)):
            raise GoogleDown(status)
        raise ItemRefused(status)

    def list_events(self, time_min, time_max):
        """Every event in the window, by id, or an exception. Never a partial answer."""
        params = {"timeMin": time_min, "timeMax": time_max, "singleEvents": "true", "showDeleted": "false",
                  "maxResults": 2500, "fields": LIST_FIELDS}
        out = {}
        for _ in range(MAX_PAGES):
            page = self._api("GET", params=params)
            if page.get("kind") != "calendar#events":
                raise GoogleDown("not a list")
            if page.get("summary") != self.account:      # a primary calendar's summary is its owner's address
                raise WrongAccount()
            out.update({e["id"]: e for e in page.get("items") or [] if isinstance(e, dict) and e.get("id")})
            if not page.get("nextPageToken"):
                return out
            params = {**params, "pageToken": page["nextPageToken"]}
        raise GoogleDown("too many pages")

    def get(self, event_id):
        """The event, or None when Google says 404 or 410."""
        return self._api("GET", event_id, params={"fields": GET_FIELDS}, ok=(404, 410))

    def insert(self, body):
        """The event, or None when the fixed id is already taken (409)."""
        return self._api("POST", params={"sendUpdates": "none"}, body=body, ok=(409,))

    def patch(self, event_id, body):
        """The event, or None when it has gone (the next run's GET decides what that means)."""
        return self._api("PATCH", event_id, params={"sendUpdates": "none"}, body=body, ok=(404, 410))

    def delete(self, event_id):
        self._api("DELETE", event_id, params={"sendUpdates": "none"}, ok=(404, 410))


# --------------------------------------------------------------- database steps
def rows(cur, sql, args=()):
    cur.execute(sql, args)
    cols = [c.name for c in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


# A date or time Python cannot hold (infinity, year 10000, 24:00) must not stop the run, so SQL hands back nulls and a flag.
DATES_OK = "((due_date is null or due_date between '2000-01-01' and '2100-12-31') and (due_time is null or due_time < '24:00'))"
# The touch trigger runs on update only, so an insert can hold an updated_at Python cannot read. It reads as null, the task
# goes on as normal, and the first change to the row puts the stamp right.
STAMP_OK = "updated_at between '2000-01-01' and '2100-12-31'"
TASK_COLS = (f"id,title,status,case when {DATES_OK} then due_date end as due_date,"
             f"case when {DATES_OK} then due_time end as due_time,est_minutes,area,"
             f"case when {STAMP_OK} then updated_at end as updated_at,{DATES_OK} as dates_ok")
# planned_for keeps following the date, as planTask does in the app, so a moved task stays on the day it moved to.
PLAN_FOLLOWS = "planned_for=case when planned_for is not null and due_date is distinct from %s::date then %s::date else planned_for end"


def write_state(cur, now, *, linked=None, ok_at=None, problem=None):
    """linked and ok_at keep their stored value when None; problem is always set."""
    cur.execute("""insert into os_calendar_state(id,linked,last_ok_at,problem,updated_at)
                   values (true, coalesce(%(l)s::boolean,false), %(k)s::timestamptz, %(p)s::text, %(n)s::timestamptz)
                   on conflict (id) do update set linked=coalesce(%(l)s::boolean, os_calendar_state.linked),
                     last_ok_at=coalesce(%(k)s::timestamptz, os_calendar_state.last_ok_at),
                     problem=%(p)s::text, updated_at=%(n)s::timestamptz""", {"l": linked, "k": ok_at, "p": problem, "n": now})


def add_event(cur, now, severity, title, body=None, area="work"):
    cur.execute("""insert into os_events(kind,title,body,severity,area,source,occurred_at)
                   values ('system',%s,%s,%s,%s,%s,%s)""", (title, body, severity, area, SOURCE, now))


def once_today(cur, now, severity, title, body=None):
    """One event of this severity and title from the calendar per IST day."""
    cur.execute("select 1 from os_events where source=%s and severity=%s and title=%s and occurred_at >= %s limit 1",
                (SOURCE, severity, title, ist_day_start(now)))
    if not cur.fetchone():
        add_event(cur, now, severity, title, body)


def save_mirror(cur, listed, now):
    """Upsert every kept event in one statement (the database is far away) and drop the rest. Called only with a complete
    list. Rows past the mirror's window go too: the links are walked from the list, never from here."""
    kept = [r for e in listed.values() if (r := mirror_row(e)) and in_mirror(parse_when(e), now)]
    cur.execute("""insert into os_calendar_events as m (id,title,starts_at,ends_at,all_day_from,all_day_to,busy,html_link,meet_link,synced_at)
                   select id,title,starts_at,ends_at,all_day_from,all_day_to,busy,html_link,meet_link,%s::timestamptz
                     from jsonb_to_recordset(%s::jsonb) as r(id text, title text, starts_at timestamptz, ends_at timestamptz,
                          all_day_from date, all_day_to date, busy boolean, html_link text, meet_link text)
                   on conflict (id) do update set title=excluded.title, starts_at=excluded.starts_at, ends_at=excluded.ends_at,
                     all_day_from=excluded.all_day_from, all_day_to=excluded.all_day_to, busy=excluded.busy,
                     html_link=excluded.html_link, meet_link=excluded.meet_link, synced_at=excluded.synced_at
                   where (m.title,m.starts_at,m.ends_at,m.all_day_from,m.all_day_to,m.busy,m.html_link,m.meet_link)
                     is distinct from (excluded.title,excluded.starts_at,excluded.ends_at,excluded.all_day_from,
                                       excluded.all_day_to,excluded.busy,excluded.html_link,excluded.meet_link)""",
                (now, json.dumps(kept)))
    cur.execute("delete from os_calendar_events where not (id = any(%s::text[]))", ([r["id"] for r in kept],))
    return len(kept)


def tag_mirror(cur):
    """task_id on the mirror follows the links, so the app shows the task row and hides its copy. A released event is
    the owner's own again, so it shows as itself."""
    cur.execute("""update os_calendar_events m set task_id=l.task_id from os_calendar_links l
                   where l.event_id=m.id and l.released_at is null and m.task_id is distinct from l.task_id""")
    cur.execute("""update os_calendar_events m set task_id=null where m.task_id is not null
                   and not exists (select 1 from os_calendar_links l where l.event_id=m.id and l.released_at is null)""")


def set_sig(cur, task_id, sig):
    cur.execute("update os_calendar_links set sig=%s where task_id=%s", (sig, task_id))


def drop_link(cur, task_id):
    cur.execute("delete from os_calendar_links where task_id=%s", (task_id,))


# --------------------------------------------------------------- one run
class Sync:
    def __init__(self, conn, cur, google, now, dry, out):
        self.conn, self.cur, self.google, self.now, self.dry, self.out = conn, cur, google, now, dry, out
        self.writes_left, self.reads_left = MAX_WRITES, MAX_SINGLE_READS
        self.clears_today = self.writes_today = 0       # this IST day, read from os_calendar_state
        self.saved_counts = (0, 0)
        self.writes_held = False
        self.refused, self.odd_dates = [], []           # task titles for the problem line
        self.stuck, self.saved_stuck = {}, {}           # tasks Google keeps refusing, from os_settings
        self.read = []                                  # links read by a direct GET this run

    def run(self):
        self.load_counts()
        listed = self.google.list_events(*window(self.now))
        self.out["listed"] = len(listed)
        if not self.dry:
            self.out["mirrored"] = save_mirror(self.cur, listed, self.now)
            tag_mirror(self.cur)
            self.cur.execute("update os_calendar_state set linked=true where id")
            self.commit()
        self.rebuild_links(listed)
        self.walk_links(listed)
        self.create_missing()
        if not self.dry:
            tag_mirror(self.cur)
            self.commit()

    def load_counts(self):
        state = rows(self.cur, "select counted_on,clears_today,writes_today from os_calendar_state where id")
        stuck = rows(self.cur, "select value from os_settings where key=%s", (STUCK_KEY,))
        self.conn.rollback()
        if stuck and isinstance(stuck[0]["value"], dict):
            self.stuck, self.saved_stuck = dict(stuck[0]["value"]), dict(stuck[0]["value"])
        if state and state[0]["counted_on"] == self.now.astimezone(IST).date():
            self.clears_today, self.writes_today = state[0]["clears_today"], state[0]["writes_today"]
            self.saved_counts = (self.clears_today, self.writes_today)

    def commit(self):
        """Every commit carries the day's counts, so a killed run loses at most the item in flight."""
        counts = (self.clears_today, self.writes_today)
        if counts != self.saved_counts and not self.dry:
            self.cur.execute("update os_calendar_state set counted_on=%s,clears_today=%s,writes_today=%s where id",
                             (self.now.astimezone(IST).date(), *counts))
            self.saved_counts = counts
        self.conn.commit()

    def take_write(self) -> bool:
        if self.writes_today >= MAX_WRITES_DAY:
            self.writes_held = True
        if self.writes_held or self.writes_left <= 0:
            self.out["waiting"] += 1
            return False
        self.writes_left -= 1
        self.writes_today += 1
        return True

    def problem_line(self):
        """A cap's line stays for the rest of the IST day, even on a run with nothing left to hold."""
        if self.clears_today >= MAX_CLEARS:
            return PROBLEM_TOO_MANY_GONE
        if self.writes_today >= MAX_WRITES_DAY:
            return PROBLEM_TOO_MANY_WRITES
        return named_line(self.refused, self.odd_dates)

    def raise_events(self):
        if self.out["held"]:
            once_today(self.cur, self.now, "bad", PROBLEM_TOO_MANY_GONE, TOO_MANY_GONE_BODY)
        if self.writes_held:
            once_today(self.cur, self.now, "bad", PROBLEM_TOO_MANY_WRITES, TOO_MANY_WRITES_BODY)
        if self.refused:
            once_today(self.cur, self.now, "warn", REFUSED_EVENT, named_line(self.refused, []))

    def would(self, action, task_id) -> bool:
        if self.dry:
            print(f"[gcal] would {action} for task {task_id}")
        return self.dry

    def item(self, t, fn, *args):
        """One item. A refusal, or anything odd about this one row, drops only what the item had not committed and names
        the task, so one bad item cannot block the rest. Google down or the database gone stops the run."""
        spent = self.writes_today
        try:
            fn(*args)
        except (GoogleDown, WrongAccount):
            raise
        except Exception as e:  # noqa: BLE001
            if self.conn.closed:
                raise
            self.conn.rollback()
            if isinstance(e, ItemRefused):
                self.writes_today = spent        # Google changed nothing, and a stuck item must not eat the day's writes
            else:
                print(f"[gcal] skipped one item: {type(e).__name__}")
            self.out["refused"] += 1
            self.refused.append(norm_title(t["title"]) if t else "a deleted task")

    # ---- crash gap
    def rebuild_links(self, listed):
        found = {}
        for e in listed.values():
            tid, when = event_task_id(e), parse_when(e)
            if tid and when and when["starts_at"] and not unmanaged(e):      # an all-day event was let go on purpose
                found[tid] = (e, when)
        if not found:
            return
        for t in rows(self.cur, f"""select {TASK_COLS} from os_tasks t
                                    where id = any(%s::uuid[]) and status='open' and due_date is not null and due_time is not null
                                      and {DATES_OK}
                                      and not exists (select 1 from os_calendar_links l where l.task_id=t.id)""", (list(found),)):
            e, when = found[str(t["id"])]
            if self.would("rebuild the link", t["id"]):
                continue
            # The event's title here is only compared: a task edited during the gap differs from it and gets pushed.
            self.cur.execute("insert into os_calendar_links(task_id,event_id,sig) values (%s,%s,%s) on conflict do nothing",
                             (t["id"], e["id"], f"{norm_title(e.get('summary'))}|{event_sig(when)}"))
            self.commit()
            self.out["rebuilt"] += 1
        self.conn.rollback()

    # ---- links
    def walk_links(self, listed):
        links = rows(self.cur, "select task_id,event_id,sig,checked_at from os_calendar_links where released_at is null")
        tasks = {t["id"]: t for t in rows(self.cur, f"select {TASK_COLS} from os_tasks where id = any(%s::uuid[])",
                                          ([str(k["task_id"]) for k in links],))}
        self.conn.rollback()
        random.shuffle(links)        # MAX_SINGLE_READS and MAX_WRITES can never starve the same links run after run
        for k in links:
            t = tasks.get(k["task_id"])
            self.item(t, self.one_link, k, t, listed)
        if self.read and not self.dry:
            self.cur.execute("update os_calendar_links set checked_at=%s where task_id = any(%s::uuid[])", (self.now, self.read))
            self.commit()

    def may_read(self, k, t) -> bool:
        """A link the list does not hold costs a GET. One waits an hour unless its task changed and could still be written."""
        fresh = k["checked_at"] is not None and self.now - k["checked_at"] < REREAD_AFTER
        changed = task_side(t) == "delete" or task_sig(t) != k["sig"]
        if (fresh and not (changed and self.writes_today < MAX_WRITES_DAY)) or self.reads_left <= 0:
            return False
        self.reads_left -= 1
        return True

    def one_link(self, k, t, listed):
        side = task_side(t)
        if side == "leave":
            return
        if t is not None and t["status"] == "open" and not t["dates_ok"]:
            self.odd_dates.append(norm_title(t["title"]))       # its date read as null: not a reason to touch the event
            return
        e = listed.get(k["event_id"])
        if e is None or e.get("status") == "cancelled":
            if not self.may_read(k, t):
                return
            e = self.google.get(k["event_id"])          # absence from a list proves nothing
            self.read.append(str(k["task_id"]))
        gone = e is None or e.get("status") == "cancelled"
        if not gone and unmanaged(e):
            self.release(k, t)
        elif side == "delete":
            self.delete_event(k, gone)
        else:
            action = event_side(t, e, k["sig"])
            if action == "none":
                return
            if action in ("clear", "all_day") and self.clears_today >= MAX_CLEARS:
                self.out["held"] += 1
                return
            if self.would(action, k["task_id"]):
                return
            getattr(self, f"do_{action}")(k, t, e)

    def release(self, k, t):
        """The owner gave the event guests or a repeat, so it is theirs now. The row stays as a marker: without it the fixed
        id would let the next run take the event back."""
        if self.would("leave the event alone", k["task_id"]):
            return
        self.cur.execute("update os_calendar_links set released_at=%s where task_id=%s", (self.now, k["task_id"]))
        if t:
            add_event(self.cur, self.now, "info", f"Left alone in Google Calendar: {norm_title(t['title'])}",
                      "It has guests or repeats now, so the app will not change it.", t["area"])
        self.commit()
        self.out["released"] += 1

    def delete_event(self, k, gone):
        if self.would("delete the event", k["task_id"]) or not (gone or self.take_write()):
            return
        if not gone:
            self.google.delete(k["event_id"])
        drop_link(self.cur, k["task_id"])
        self.cur.execute("delete from os_calendar_events where id=%s", (k["event_id"],))
        self.commit()
        self.out["deleted"] += 1

    def do_store(self, k, t, e):
        set_sig(self.cur, k["task_id"], task_sig(t))
        self.commit()

    def do_push(self, k, t, e):
        if not self.take_write():
            return
        was_all_day = not (parse_when(e) or {}).get("starts_at")
        body = event_times(t, was_all_day)
        if norm_title(t["title"]) != split_sig(k["sig"])[0]:
            body["summary"] = norm_title(t["title"])    # only a change of ours, so a rename in Google is never undone
        if self.google.patch(k["event_id"], body) is None:
            return
        set_sig(self.cur, k["task_id"], task_sig(t))
        self.commit()
        self.out["patched"] += 1

    def _update_task(self, t, sql, args) -> bool:
        """Guarded on the updated_at we read: a concurrent edit in the app wins and the next run looks again. A stamp that
        read as null cannot be compared, so that one row goes through and the touch trigger repairs it."""
        self.cur.execute(f"update os_tasks set {sql} where id=%s and (updated_at=%s or %s::timestamptz is null) and status='open'",
                         (*args, t["id"], t["updated_at"], t["updated_at"]))
        if self.cur.rowcount == 1:
            return True
        self.conn.rollback()
        return False

    def do_pull(self, k, t, e):
        """Date, time and length. Never the title."""
        when = parse_when(e)
        local = when["starts_at"].astimezone(IST)
        day, at = local.date(), local.time().replace(second=0, microsecond=0)
        minutes = event_minutes(when)
        est = t["est_minutes"] if minutes == task_minutes(t) else minutes
        moved = (day, at) != (t["due_date"], t["due_time"].replace(second=0, microsecond=0))
        ring_again = ", pushed_at=null" if moved and when["starts_at"] > self.now else ""
        if not self._update_task(t, f"due_date=%s, due_time=%s, est_minutes=%s, {PLAN_FOLLOWS}{ring_again}", (day, at, est, day, day)):
            return
        # The stored title stays: a title changed in the app meanwhile still differs from it, so the next run pushes it.
        set_sig(self.cur, k["task_id"], f"{split_sig(k['sig'])[0]}|{event_sig(when)}")
        add_event(self.cur, self.now, "info", f"Moved in Google Calendar: {norm_title(t['title'])}", was_on(t), t["area"])
        self.commit()
        self.out["pulled"] += 1

    def do_all_day(self, k, t, e):
        day = parse_when(e)["all_day_from"]
        if not self._update_task(t, f"due_date=%s, due_time=null, {PLAN_FOLLOWS}", (day, day, day)):
            return
        drop_link(self.cur, k["task_id"])
        add_event(self.cur, self.now, "info", f"Moved in Google Calendar: {norm_title(t['title'])}",
                  f"It is now all day, so its time was cleared. {was_on(t)}", t["area"])
        self.clears_today += 1
        self.commit()
        self.out["all_day"] += 1

    def do_clear(self, k, t, e):
        if not self._update_task(t, "due_time=null", ()):
            return
        drop_link(self.cur, k["task_id"])
        self.cur.execute("delete from os_calendar_events where id=%s", (k["event_id"],))
        add_event(self.cur, self.now, "info", f"Deleted in Google Calendar: {norm_title(t['title'])}",
                  f"The task stays. Its time was cleared. {was_on(t)}", t["area"])
        self.clears_today += 1
        self.commit()
        self.out["cleared"] += 1

    # ---- new events
    def create_missing(self):
        today = self.now.astimezone(IST).date()
        todo = rows(self.cur, f"""select {TASK_COLS} from os_tasks t
                                  where status='open' and due_date >= %s and due_time is not null
                                    and not exists (select 1 from os_calendar_links l where l.task_id=t.id)
                                  order by due_date, due_time""", (today,))
        self.conn.rollback()
        random.shuffle(todo)         # tasks Google keeps refusing can never use up the writes of every run
        for t in todo:
            if not t["dates_ok"]:
                self.odd_dates.append(norm_title(t["title"]))
            elif self.resting(t):
                self.out["resting"] += 1
                self.refused.append(norm_title(t["title"]))
            else:
                self.item(t, self.create_noting_refusal, t)
        self.save_stuck(todo)

    def resting(self, t) -> bool:
        """Refused for GIVE_UP_AFTER and already tried in the last RETRY_EVERY. A task that changed gets a fresh start. The
        app can write this key, so a bad entry must only ever mean one more try."""
        seen = self.stuck.get(str(t["id"]))
        if not isinstance(seen, dict) or seen.get("sig") != task_sig(t):
            return False
        try:
            since, tried = datetime.fromisoformat(seen["since"]), datetime.fromisoformat(seen["tried"])
            return self.now - since >= GIVE_UP_AFTER and self.now - tried < RETRY_EVERY
        except (KeyError, TypeError, ValueError):
            return False

    def create_noting_refusal(self, t):
        try:
            self.create_one(t)
        except ItemRefused:
            key, sig, stamp = str(t["id"]), task_sig(t), self.now.isoformat()
            seen = self.stuck.get(key)
            since = seen.get("since") if isinstance(seen, dict) and seen.get("sig") == sig else None
            self.stuck[key] = {"sig": sig, "since": since or stamp, "tried": stamp}
            raise

    def save_stuck(self, todo):
        """Only tasks still without an event stay listed, so one that went on or went away leaves by itself on a later run.
        A task the writes ran out on keeps its entry, so a long list of stuck tasks still reaches GIVE_UP_AFTER."""
        waiting = {str(t["id"]) for t in todo}
        self.stuck = {k: v for k, v in self.stuck.items() if k in waiting}
        if self.stuck != self.saved_stuck and not self.dry:
            self.cur.execute("""insert into os_settings(key,value) values (%s,%s::jsonb)
                                on conflict (key) do update set value=excluded.value, updated_at=now()""",
                             (STUCK_KEY, json.dumps(self.stuck)))
            self.saved_stuck = dict(self.stuck)
            self.commit()

    def create_one(self, t):
        if self.would("create an event", t["id"]) or not self.take_write():
            return
        body = new_event(t)
        if self.google.insert(body) is None:            # 409: this id exists, perhaps cancelled. Bring it back
            e = self.google.get(body["id"])
            # Google only promises the id on a deleted event, and that id is made from this task.
            cancelled = e is not None and e.get("status") == "cancelled"
            if e is None or not (cancelled or (((e.get("extendedProperties") or {}).get("private")) or {}).get("workos_task") == str(t["id"])):
                raise ItemRefused(409)
            if unmanaged(e):        # the owner's now, deleted or not: mark it, or every run would ask again
                self.cur.execute("""insert into os_calendar_links(task_id,event_id,sig,released_at) values (%s,%s,%s,%s)
                                    on conflict do nothing""", (t["id"], body["id"], task_sig(t), self.now))
                self.commit()
                self.out["released"] += 1
                return
            if not self.take_write():
                return
            was_all_day = not (parse_when(e) or {}).get("starts_at")
            revived = {k: v for k, v in body.items() if k != "id"}
            if self.google.patch(body["id"], {**revived, **event_times(t, was_all_day), "status": "confirmed"}) is None:
                raise ItemRefused(409)
        self.cur.execute("insert into os_calendar_links(task_id,event_id,sig) values (%s,%s,%s) on conflict do nothing",
                         (t["id"], body["id"], task_sig(t)))
        self.commit()
        self.out["created"] += 1


def run(conn, now, dry=False, http=None):
    creds = [os.environ.get(k, "") for k in ("GCAL_CLIENT_ID", "GCAL_CLIENT_SECRET", "GCAL_REFRESH_TOKEN", "GCAL_ACCOUNT")]
    out = dict.fromkeys(("rebuilt", "patched", "pulled", "all_day", "cleared", "deleted", "created", "released", "held",
                         "waiting", "refused", "resting"), 0)
    out.update(linked=all(creds), problem=None)
    with conn.cursor() as cur:
        cur.execute("select pg_try_advisory_lock(hashtext(%s))", (LOCK_KEY,))
        if not cur.fetchone()[0]:
            conn.rollback()
            out["skipped"] = "another run holds the lock"
            return out
        conn.commit()                # the lock is the session's; no transaction stays open while Google answers
        try:
            return _run(conn, cur, now, dry, http or http_call, creds, out)
        finally:
            if not conn.closed:      # a lost connection took the lock with it, and raising here would hide why
                conn.rollback()
                cur.execute("select pg_advisory_unlock(hashtext(%s))", (LOCK_KEY,))
                conn.commit()


def _failed(sync, cur, now, dry, out, problem, severity, body=None):
    """Words for the owner and one event a day. Nothing else moves: last_ok_at, the link flag and every row stay.
    If the database itself is the failure this raises, the unit goes red, and the watchdog sees updated_at stop."""
    sync.conn.rollback()
    out["problem"] = problem
    if not dry:
        once_today(cur, now, severity, problem, body)
        write_state(cur, now, problem=problem)
        sync.commit()
    return out


def _run(conn, cur, now, dry, http, creds, out):
    if not all(creds):
        if not dry:
            cur.execute("delete from os_calendar_events")       # old meetings must not stay in the day's order
            write_state(cur, now, linked=False)
            conn.commit()
        return out
    google = Google(http, *creds)
    sync = Sync(conn, cur, google, now, dry, out)
    try:
        google.sign_in()
        sync.run()
    except SignInNeeded:
        return _failed(sync, cur, now, dry, out, PROBLEM_SIGN_IN, "bad", SIGN_IN_BODY)
    except WrongAccount:
        return _failed(sync, cur, now, dry, out, PROBLEM_WRONG_ACCOUNT, "bad", WRONG_ACCOUNT_BODY)
    except (GoogleDown, ItemRefused):
        return _failed(sync, cur, now, dry, out, PROBLEM_DOWN, "warn")
    except Exception as e:  # noqa: BLE001  (a run that dies here must still leave words behind)
        print(f"[gcal] stopped: {type(e).__name__}")
        return _failed(sync, cur, now, dry, out, PROBLEM_STOPPED, "warn")
    out["problem"] = sync.problem_line()
    if not dry:
        sync.raise_events()
        write_state(cur, now, linked=True, ok_at=now, problem=out["problem"])
        sync.commit()
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--now")
    a = ap.parse_args()
    url = os.environ.get("SUPABASE_DB_URL")
    if not url:
        sys.exit("SUPABASE_DB_URL is not set.")
    import psycopg
    now = datetime.fromisoformat(a.now).astimezone(IST) if a.now else datetime.now(IST)
    with psycopg.connect(url) as conn:
        print(json.dumps(run(conn, now, a.dry_run)))


if __name__ == "__main__":
    main()
