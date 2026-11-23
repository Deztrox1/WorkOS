import { addDays, istDate, istTime, istToMs } from '../../shared/ist';
import { nextFire } from '../../shared/nextFire';
import type { Balance, Campaign, ClaudeRequest, Day, Habit, OsEvent, Reminder, Task } from '../types';
import { inFlight } from '../types';
import { bounceText, todayCampaigns } from './campaigns';
import { dayMonth, dayTime, vendorLabel } from './format';
import { byPickOrder, sortTasks } from './tasks';

/** The priority word a row carries. NOW red, TODAY amber, PLAN green, OLDER grey. The word prints once per run of a band. */
export type Band = 'now' | 'today' | 'plan' | 'older';
/**
 * What the time spine shows for a row: a time, a due date (1 Sep), or est minutes (10m). `note` is a small word under it
 * (missed); `sr` is what a screen reader hears instead of the text. Null leaves it blank.
 */
export type Spine = { text: string; tone: 'time' | 'past' | 'date' | 'est'; note?: string; sr?: string } | null;

type Base = { band: Band; at: number | null; spine: Spine };
/** `done`: finished today, kept on the sheet struck (QA r2 P08). `missed`: open, and its time has passed today. */
export type SheetTask = Base & { kind: 'task'; task: Task; done: boolean; missed: boolean };
export type SheetReminder = Base & { kind: 'reminder'; at: number; reminder: Reminder; struck: boolean };
export type SheetHabit = Base & { kind: 'habit'; habit: Habit; done: boolean };
export type SheetAlert = Base & { kind: 'alert'; band: 'now'; at: number; event: OsEvent };
/** An exception the collectors found (bounce over 3 %, no live campaign, low balance): a NOW row that links to its screen. */
export type SheetFlag = Base & { kind: 'flag'; band: 'now'; id: string; title: string; body: string; to: string };
export type SheetRow = SheetTask | SheetReminder | SheetHabit | SheetAlert | SheetFlag;

export type Sheet = {
  /**
   * What the owner put on today. Above the "now" line: what has passed (rings, habits, tasks done). Below it: tasks whose time
   * passed (missed), his untimed picks in his order, then the timed rows still to come, then untimed habits.
   */
  today: SheetRow[];
  /** Where the "now" marker sits in `today`: the count of rows above the line. */
  nowAt: number;
  /** At most `alertCap` unread bad alerts, then the work exceptions. */
  now: (SheetAlert | SheetFlag)[];
  /** Due today, not placed. */
  plan: SheetTask[];
  /** Overdue and not picked for today. The sheet folds these into one line. */
  older: SheetTask[];
  /** The row the greeting names. */
  first: SheetRow | null;
  /** Estimated minutes of today's open tasks. */
  minutes: number;
  /** Planned tasks that sit under With Claude instead of in the plan, and the ids of every task Claude holds. */
  withClaude: number;
  claude: ReadonlySet<string>;
};

export type SheetInput = {
  open: Task[]; reminders: Reminder[]; unread: OsEvent[]; today: string; nowMs: number;
  habits?: Habit[]; habitDone?: Set<string>; flags?: SheetFlag[]; alertCap?: number;
  /** Tasks finished today: they stay on the sheet, struck, in their place (QA r2 P08). */
  doneToday?: Task[];
  /** Last night's pick order for today (`os_days.top_task_ids`, QA r2 P03). */
  pickOrder?: readonly string[];
  /** Tasks Claude is working on: they are never First (QA r2 P01). */
  claudeTasks?: ReadonlySet<string>;
  /** Reminders ticked, as reminder id to IST day (QA r2 P16). */
  remindersDone?: Record<string, string>;
};

const MINUTE = 60_000;
/** First: a timed task or habit due inside this window beats his first pick (QA r2 decision 2). */
export const SOON_MS = 30 * MINUTE;
const timeOf = (t: Task, today: string) => (t.due_time && t.due_date === today ? istToMs(today, t.due_time.slice(0, 5)) : null);
const est = (t: Task): Spine => (t.est_minutes ? { text: `${t.est_minutes}m`, tone: 'est' } : null);
const clock = (at: number, nowMs: number): Spine => ({ text: istTime(at), tone: at < nowMs - MINUTE + 1 ? 'past' : 'time' });

/** The unread bad alerts the sheet shows, newest first. Activity's badge leaves these out (they are already on Today). */
export function sheetAlerts(unread: OsEvent[], cap = 2): OsEvent[] {
  return unread
    .filter((e) => !e.read_at && e.severity === 'bad')
    .sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : a.occurred_at > b.occurred_at ? -1 : 0))
    .slice(0, cap);
}

/**
 * Build the sheet for one day. Pure. Tasks must already be open (and in the mode) with `doneToday` the ones finished today;
 * habits already scheduled today. Order (QA r1 decision 1, r2 decision 2): the owner's own plan and timed rows first, then at
 * most two bad alerts and the exceptions, then due-today tasks to place, then the overdue backlog, which the screen folds.
 */
export function buildSheet(i: SheetInput): Sheet {
  const {
    open, reminders, unread, today, nowMs, habits = [], habitDone = new Set<string>(), flags = [], alertCap = 2,
    doneToday = [], pickOrder = [], claudeTasks = new Set<string>(), remindersDone = {},
  } = i;
  const dayStart = istToMs(today, '00:00');
  const dayEnd = istToMs(addDays(today, 1), '00:00');
  const cut = nowMs - MINUTE + 1;
  const finished = new Set(doneToday.map((t) => t.id));

  const rems: SheetReminder[] = [];
  for (const r of reminders) {
    const firedAt = r.last_fired_at ? new Date(r.last_fired_at).getTime() : null;
    const struck = remindersDone[r.id] === today;
    if (r.repeat === 'none' && firedAt !== null && firedAt >= dayStart && firedAt < dayEnd) {
      rems.push({ kind: 'reminder', band: 'today', at: firedAt, spine: clock(firedAt, nowMs), reminder: r, struck });
      continue;
    }
    if (!r.active) continue;
    const f = nextFire(r, dayStart - 1);
    if (f === null || f >= dayEnd) continue;
    rems.push({ kind: 'reminder', band: 'today', at: f, spine: clock(f, nowMs), reminder: r, struck });
  }

  // A task finished today keeps the place it had: with the planned ones, or with the ones due today (QA r2 P08).
  const pool = [...open, ...doneToday];
  const placed = (t: Task) => t.planned_for === today || (finished.has(t.id) && t.due_date !== today);
  const planned = byPickOrder(pool.filter(placed), pickOrder);
  const dueToday = sortTasks(pool.filter((t) => !placed(t) && t.due_date === today && (finished.has(t.id) || t.planned_for === null || t.planned_for < today)));
  const taskRow = (t: Task, band: Band, at: number | null, spine: Spine): SheetTask => {
    const done = finished.has(t.id);
    return { kind: 'task', band, at, spine, task: t, done, missed: !done && at !== null && at < cut };
  };
  const timedTasks: SheetTask[] = [...planned, ...dueToday].flatMap((t) => {
    const at = timeOf(t, today);
    if (at === null) return [];
    const row = taskRow(t, 'today', at, clock(at, nowMs));
    return [row.missed ? { ...row, spine: { ...(row.spine as NonNullable<Spine>), tone: 'past' as const } } : row];
  });
  const hab: SheetHabit[] = habits.map((h) => {
    const at = h.time_local ? istToMs(today, h.time_local.slice(0, 5)) : null;
    return { kind: 'habit', band: 'today', at, spine: at === null ? null : clock(at, nowMs), habit: h, done: habitDone.has(h.id) };
  });
  const timed: SheetRow[] = [...rems, ...timedTasks, ...hab.filter((h) => h.at !== null)].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  const untimedPlanned: SheetTask[] = planned.filter((t) => timeOf(t, today) === null).map((t) => taskRow(t, 'today', null, est(t)));
  const isMissed = (r: SheetRow) => r.kind === 'task' && r.missed;
  const above = timed.filter((r) => (r.at ?? 0) < cut && !isMissed(r));
  const below = timed.filter((r) => (r.at ?? 0) >= cut || isMissed(r));
  // Past rows, the now line, missed tasks, his picks, then what is still to come (QA r2 P02).
  const todayRows: SheetRow[] = [
    ...above, ...below.filter(isMissed), ...untimedPlanned, ...below.filter((r) => !isMissed(r)), ...hab.filter((h) => h.at === null),
  ];

  const plan: SheetTask[] = dueToday.filter((t) => timeOf(t, today) === null).map((t) => taskRow(t, 'plan', null, est(t)));
  const older: SheetTask[] = open
    .filter((t) => t.due_date !== null && t.due_date < today && t.planned_for !== today && (t.planned_for === null || t.planned_for < today))
    .sort((a, b) => a.priority - b.priority || (a.due_date! < b.due_date! ? -1 : a.due_date! > b.due_date! ? 1 : 0) || a.sort_order - b.sort_order)
    .map((t) => taskRow(t, 'older', null, { text: dayMonth(t.due_date as string), tone: 'date', sr: `due ${dayMonth(t.due_date as string)}` }));

  const now: (SheetAlert | SheetFlag)[] = [
    ...sheetAlerts(unread, alertCap).map((e): SheetAlert => ({ kind: 'alert', band: 'now', at: new Date(e.occurred_at).getTime(), spine: null, event: e })),
    ...flags,
  ];
  // First is always something to do: a task or a timed row, never an alert (QA r3 P03).
  const first = pickFirst(todayRows, nowMs, claudeTasks) ?? plan.find((r) => !r.done && !claudeTasks.has(r.task.id)) ?? null;
  // His picks that Claude is working on leave the plan for With Claude; the greeting says so (QA r3 P02).
  const withClaude = planned.filter((t) => !finished.has(t.id) && claudeTasks.has(t.id)).length;
  const minutes = [...planned, ...dueToday.filter((t) => timeOf(t, today) !== null)].filter((t) => !finished.has(t.id) && !claudeTasks.has(t.id)).reduce((s, t) => s + (t.est_minutes ?? 0), 0);
  return { today: todayRows, nowAt: above.length, now, plan, older, first, minutes, withClaude, claude: claudeTasks };
}

/**
 * The row the greeting names (QA r2 P01, decision 2): a timed task or habit due inside 30 minutes, else his first pick
 * (untimed, in his order), else the next task. Reminders are never First. Tasks Claude has are skipped.
 */
function pickFirst(rows: SheetRow[], nowMs: number, claude: ReadonlySet<string>): SheetRow | null {
  const free = (r: SheetRow): r is SheetTask => r.kind === 'task' && !r.done && !claude.has(r.task.id);
  const soon = rows
    .filter((r) => (free(r) || (r.kind === 'habit' && !r.done)) && r.at !== null && r.at >= nowMs - MINUTE + 1 && r.at <= nowMs + SOON_MS)
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0))[0];
  return soon ?? rows.find((r): r is SheetTask => free(r) && r.at === null) ?? rows.find(free) ?? null;
}

/** The tasks on today's sheet, open and done: what "Close today" lists (habits are a quiet line of their own, QA r2 P15). */
export const closeRows = (s: Sheet): SheetTask[] => [...s.today, ...s.plan].filter((r): r is SheetTask => r.kind === 'task');

/**
 * The evening lead: close today first, then tomorrow (QA r1 F06). Counts tasks done and still open (QA r2 P08, P15). Once
 * tomorrow has a first pick the lead says so at the top, so he sees the day is set without scrolling (QA r3 P06).
 */
export function eveningLine(s: Sheet, tomorrowFirst: string | null = null): string {
  const rows = closeRows(s);
  const done = rows.filter((r) => r.done).length;
  const n = rows.length - done;
  const next = tomorrowFirst ? closingLine(tomorrowFirst) : 'Pick tomorrow.';
  if (!n) return done ? `${done} done today. ${next}` : next;
  return `Close today: ${done ? `${done} done, ` : ''}${n} still open. ${tomorrowFirst ? next : 'Then pick tomorrow.'}`;
}

/** The last line of the evening sheet (QA r2 C06): the day ends, and the morning has a first thing to start with. */
export function closingLine(firstPick: string | null): string {
  return firstPick ? `Tomorrow is set. It starts with ${firstPick}.` : 'Nothing picked. Tomorrow starts with the oldest tasks.';
}

/** The first sentence of last night's review and the mood, as one quiet morning line (QA r2 P14). Null when there is neither. */
export function lastNight(prev: Day | undefined): string | null {
  const review = prev?.review?.trim() ?? '';
  const mood = prev?.mood ?? null;
  if (!review && mood === null) return null;
  const first = review.split(/(?<=[.!?])\s|\n/)[0].replace(/[.!?]+$/, '').trim();
  if (!first) return `Last night: mood ${mood}.`;
  return `Last night: ${first}.${mood !== null ? ` Mood ${mood}.` : ''}`;
}

/** True when the plan line of this day was last saved before the day began: he wrote it the night before (QA r2 C07). */
export function wroteLastNight(row: Day | undefined, today: string): boolean {
  if (!row?.plan?.trim() || !row.updated_at) return false;
  return new Date(row.updated_at).getTime() < istToMs(today, '00:00');
}

/** Exceptions from the work numbers, as NOW rows (QA r1 F10). Totals stay on Campaigns. */
export function workFlags(latest: Campaign[], balances: Record<string, Balance>, limits: Record<string, number>, lastSend: string | null): SheetFlag[] {
  const out: SheetFlag[] = [];
  const flag = (id: string, title: string, body: string, to: string): SheetFlag => ({ kind: 'flag', band: 'now', at: null, spine: null, id, title, body, to });
  if (latest.some((c) => c.channel === 'email')) {
    const c = todayCampaigns(latest, [], '');
    if (c.activeEmail === 0) out.push(flag('no-email', 'No email campaign running', lastSend ? `Last send ${dayMonth(lastSend)}.` : 'Nothing has sent yet.', '/campaigns'));
    if (c.worst) out.push(flag('bounce', `${c.worst.campaign_name}: ${bounceText(c.worst.sent_total, c.worst.bounces_total)} bounced`, `${c.worst.bounces_total} of ${c.worst.sent_total} bounced. Over 3% can hurt your inboxes. Open Campaigns to check the list.`, '/campaigns'));
  }
  for (const [v, b] of Object.entries(balances)) {
    const l = b.limit ?? limits[v] ?? null;
    if (l !== null && b.value !== null && b.value < l * 0.1) out.push(flag(`bal-${v}`, `${vendorLabel(v)} is low`, `${b.value.toLocaleString('en-US')} left of ${l.toLocaleString('en-US')}.`, '/settings'));
  }
  return out;
}

// ------------------------------------------------------------------ Claude on the sheet
export type ClaudeState = 'queued' | 'working' | 'stuck' | 'done' | 'failed';
/** In flight longer than this reads "no word" (QA r1 decision 2). */
export const STUCK_MS = 2 * 3600_000;

/** On Today: requests in flight, and finished ones the owner has not seen yet. Cancelled ones never. */
export const claudeOnToday = (r: ClaudeRequest) => inFlight(r.status) || ((r.status === 'done' || r.status === 'failed') && !r.seen_at);

/** The owner copied the brief into Claude Code himself: no session to watch, and it closes when he ticks the task. */
const byHand = (r: ClaudeRequest) => r.handoff === 'copy';

export function claudeState(r: ClaudeRequest, nowMs: number): ClaudeState {
  if (r.status === 'done') return 'done';
  if (r.status === 'failed' || r.status === 'cancelled') return 'failed';
  if (byHand(r)) return 'working';
  if (nowMs - new Date(r.sent_at ?? r.created_at).getTime() > STUCK_MS) return 'stuck';
  return r.status === 'sent' ? 'working' : 'queued';
}

/** The one line a row carries about its request (QA r2 C11, C12, P06). */
export function claudeText(r: ClaudeRequest, nowMs: number): string {
  const at = new Date(r.sent_at ?? r.created_at).getTime();
  const since = istTime(at);
  switch (claudeState(r, nowMs)) {
    case 'queued': return `Claude: not started yet (asked ${since})`;
    case 'working': return byHand(r) ? `With Claude Code since ${since}. Tick the task when done.` : `Claude: working since ${since}`;
    case 'stuck': return `Claude: no word since ${dayTime(at)}. Open the session to check.`;
    case 'done': return r.result ? `Claude finished: ${r.result}` : 'Claude finished. Open the session to see it.';
    case 'failed': return `Claude could not finish${r.error ? `: ${r.error}` : '.'}`;
  }
}

// ------------------------------------------------------------------ evening
/** Added today with no date: nothing else would ever bring it back (QA r2 P04). */
export const capturedToday = (t: Task, today: string) => t.due_date === null && istDate(new Date(t.created_at).getTime()) === today;

/**
 * Suggested picks for tomorrow, across both areas (QA r1 F06, F07; r2 P04, P12): what he captured today with no date, then
 * what is due tomorrow, then at most two overdue ones by priority. Leaves out what is already picked, planned for later or
 * still planned for today (that is closed on the sheet), and tasks in `skip` (the ones Claude holds).
 */
export function suggestPicks(all: Task[], today: string, cap = 8, skip: ReadonlySet<string> = new Set()): Task[] {
  const tm = addDays(today, 1);
  const free = all.filter((t) => t.status === 'open' && (t.planned_for === null || t.planned_for < today) && !skip.has(t.id));
  const byDue = (a: Task, b: Task) => a.priority - b.priority || (a.due_date! < b.due_date! ? -1 : a.due_date! > b.due_date! ? 1 : 0);
  const main = [
    ...free.filter((t) => capturedToday(t, today)).sort((a, b) => a.priority - b.priority || (a.created_at < b.created_at ? 1 : -1)),
    ...free.filter((t) => t.due_date === tm).sort(byDue),
    ...free.filter((t) => t.due_date !== null && t.due_date < today).sort(byDue).slice(0, 2),
  ];
  // A thin list (by day 3 of a week it ran dry) is topped up with the undated tasks left alone longest, so the
  // evening never ends on a bare "Show all" list (QA r3 P04).
  if (main.length < 3) {
    const seen = new Set(main.map((t) => t.id));
    main.push(...free.filter((t) => t.due_date === null && !seen.has(t.id)).sort((a, b) => (a.updated_at < b.updated_at ? -1 : 1)).slice(0, 5));
  }
  return main.slice(0, cap);
}

/** The sheet turns to tomorrow from 18:00 IST. */
export const isEvening = (hh: number) => hh >= 18;

export function sheetName(hh: number): string {
  if (hh < 5 || hh >= 23) return 'Night shift';
  if (hh < 12) return 'Morning shift';
  if (hh < 18) return 'Day shift';
  return 'Evening shift';
}
