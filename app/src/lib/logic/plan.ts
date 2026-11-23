import { addDays, istToMs } from '../../shared/ist';
import type { CalendarEvent, CalendarState, Habit, Reminder, Task } from '../types';
import { dayMonth } from './format';
import type { Sheet, SheetHabit, SheetTask } from './today';

/**
 * The war room's plan (logs/qa-r4-plan.md decisions 9 to 11, calls A to M): the whole day, both areas, in the order to do it. It
 * is built fresh from the current minute every time, so running behind only moves the order. Nothing here is ever late.
 */
const MINUTE = 60_000;
/** A task with no estimate takes this long in the plan. */
export const TASK_MINUTES = 30;
const HABIT_MINUTES = 15;
const STEP_MINUTES = 15;
/** A task stays Now until the next fixed thing is this close (call C). */
export const HOLD_MS = 5 * MINUTE;
/** With no task to do, a fixed thing is Now only inside this window; further off the day reads "Free until" (call C). */
export const PLAN_SOON_MS = 30 * MINUTE;
/** A gap after Now that is shorter than this is left empty (call D). */
const MIN_GAP_MS = 15 * MINUTE;
/** A busy event this long is a backdrop (a work day, a trip), not a thing to do: it shows, but it never holds Now. */
const BACKDROP_MS = 4 * 3600_000;
/** From DAY_END to DAY_START no new work is offered (call I). */
const DAY_END = '23:00';
const DAY_START = '05:00';
/** Where "Plan tomorrow" sits in the order while nothing is picked for tomorrow (call H). */
const STEP_AT = '21:00';
export const PLAN_STEP_ID = 'plan-tomorrow';
const STEP_NAME = 'Plan tomorrow';
const SUGGEST = 3;

type Slot = { at: number; end: number; running: boolean };
export type PlanTask = Slot & { kind: 'task'; id: string; task: Task; fixed: boolean; suggested: boolean };
export type PlanHabit = Slot & { kind: 'habit'; id: string; habit: Habit; fixed: boolean; anyTime: boolean };
export type PlanEvent = Slot & { kind: 'event'; id: string; event: CalendarEvent; fixed: true };
/** The evening step: open /plan and pick tomorrow. */
export type PlanStep = Slot & { kind: 'step'; id: string; fixed: true };
/** A mark takes no time (a reminder, a Free event): it sits in the list at its time and is never Now or Next. */
export type PlanMark = Slot & { kind: 'mark'; id: string; reminder?: Reminder; event?: CalendarEvent; fixed: true };
export type PlanItem = PlanTask | PlanHabit | PlanEvent | PlanStep;
export type PlanRow = PlanItem | PlanMark;

export type Plan = {
  /** The one thing to do now, and the one after it. */
  now: PlanItem | null;
  next: PlanItem | null;
  /** Everything after Now in time order, Next and the marks included, then the habits with no time. */
  rows: PlanRow[];
  /** Tasks that do not fit before the day ends. */
  spare: PlanTask[];
  /** Habits whose time has gone by with no tick. They are off the plan, and the owner can still tick them (R4Y02). */
  passed: Habit[];
  /** All-day events and backdrops, as one quiet line. */
  allDay: CalendarEvent[];
  /** The first fixed item after Now, and the minutes free until it. */
  fixedNext: PlanItem | null;
  freeMin: number | null;
  /** Task ids the owner can reorder, in order: what "Not now" and "Do first" rewrite. */
  queue: string[];
  /** Today's events that have ended, or were finished early. */
  earlier: CalendarEvent[];
  /** No task to do and the next fixed thing is over 30 minutes off: Now reads "Free until". */
  freeUntil: PlanItem | null;
  /** Nothing is picked, so the rows are the app's own start (call B). */
  started: boolean;
  /** The day's tasks are done (call F), and whether another can be offered. */
  finished: boolean;
  canMore: boolean;
  /** Between 23:00 and 05:00: no new work (call I). */
  night: boolean;
};

/** Today's skip list (`os_settings.plan_skip`, call E). `more` is how many extra tasks were asked for with One more. */
export type PlanSkip = { ids: readonly string[]; more: number };
const NO_SKIP: PlanSkip = { ids: [], more: 0 };

export type PlanInput = {
  sheet: Sheet;
  nowMs: number;
  today: string;
  events?: CalendarEvent[];
  /** Every open task, both areas: where suggestions come from. */
  open?: Task[];
  /** Today's saved order (`os_days.top_task_ids`). */
  order?: readonly string[];
  skip?: PlanSkip;
  /** Tasks picked for tomorrow. At 0 "Plan tomorrow" joins the order; left out, it does not. */
  tomorrowPicked?: number;
  /** The task that was Now a moment ago: a gap getting shorter never swaps it for a smaller one (R4P05). */
  keep?: string | null;
};

const minutes = (t: Task) => (t.est_minutes && t.est_minutes > 0 ? t.est_minutes : TASK_MINUTES);
const ms = (iso: string | null) => new Date(iso as string).getTime();
const named = (s: string) => s.trim().toLowerCase();

/**
 * Events on one IST day: timed ones that start that day or began earlier and run into it (a 3-day conference, a call over
 * midnight, R4X11), and all-day ones that cover it. Copies of tasks are left out.
 */
export function eventsOn(events: CalendarEvent[], day: string): { timed: CalendarEvent[]; allDay: CalendarEvent[] } {
  const from = istToMs(day);
  const to = istToMs(addDays(day, 1));
  const mine = events.filter((e) => !e.task_id);
  return {
    timed: mine
      .filter((e) => e.starts_at && ms(e.starts_at) < to && (ms(e.starts_at) >= from || ms(e.ends_at) > from))
      .sort((a, b) => (a.starts_at as string).localeCompare(b.starts_at as string)),
    allDay: mine.filter((e) => e.all_day_from && e.all_day_to && e.all_day_from <= day && e.all_day_to > day),
  };
}

/**
 * What to offer when the day has room: older tasks by priority, then the undated ones by priority, left alone longest first.
 * `waiting_on` does not block a task: on live data it holds what the owner must decide (call A).
 */
function suggestions(sheet: Sheet, open: Task[], today: string, leave: ReadonlySet<string>): Task[] {
  const free = (t: Task) => !sheet.claude.has(t.id) && !leave.has(t.id) && (t.planned_for === null || t.planned_for < today);
  const undated = open.filter((t) => t.due_date === null && free(t)).sort((a, b) => a.priority - b.priority || (a.updated_at < b.updated_at ? -1 : 1));
  return [...sheet.older.map((r) => r.task).filter(free), ...undated];
}

type Flex = { carried: boolean; item: PlanTask };
/** Order by the saved list. Not in it: a task whose time has passed goes first, anything else goes last. */
function inOrder(items: Flex[], order: readonly string[]): Flex[] {
  const at = new Map(order.map((id, i) => [id, i]));
  const rank = (x: Flex) => at.get(x.item.id) ?? (x.carried ? -1 : Number.MAX_SAFE_INTEGER);
  return items.map((x, i) => ({ x, i })).sort((a, b) => rank(a.x) - rank(b.x) || a.i - b.i).map(({ x }) => x);
}

export function buildPlan({ sheet, nowMs, today, events = [], open = [], order = [], skip = NO_SKIP, tomorrowPicked, keep = null }: PlanInput): Plan {
  const cut = nowMs - MINUTE + 1;
  const dayEnd = istToMs(today, DAY_END);
  const midnight = istToMs(addDays(today, 1));
  const smallHours = nowMs < istToMs(today, DAY_START);
  const night = smallHours || nowMs >= dayEnd;
  const skipped = new Set(skip.ids);
  const held = (r: SheetTask) => sheet.claude.has(r.task.id);
  const day = eventsOn(events, today);
  const allDay = [...day.allDay];
  const earlier: CalendarEvent[] = [];
  const fixed: PlanItem[] = [];
  const marks: PlanMark[] = [];

  // A habit and a calendar block with the same name are one thing: the habit keeps its tick and takes the block's time.
  const habitNames = new Set(sheet.today.flatMap((r) => (r.kind === 'habit' ? [named(r.habit.name)] : [])));
  const blockFor = new Map<string, CalendarEvent>();

  for (const e of day.timed) {
    const at = ms(e.starts_at);
    const end = ms(e.ends_at);
    if (habitNames.has(named(e.title))) { blockFor.set(named(e.title), e); continue; }
    if (end - at >= BACKDROP_MS) { if (end > nowMs) allDay.push(e); continue; }
    if (end <= nowMs || (skipped.has(e.id) && at <= nowMs)) { earlier.push(e); continue; }
    if (e.busy) fixed.push({ kind: 'event', id: e.id, event: e, at, end, running: at <= nowMs, fixed: true });
    else if (at >= cut) marks.push({ kind: 'mark', id: e.id, event: e, at, end: at, running: false, fixed: true });
  }

  const stepAt = istToMs(today, STEP_AT);
  const stepDue = tomorrowPicked === 0 && !night;
  const stepOn = stepDue && !skipped.has(PLAN_STEP_ID);
  if (stepOn) fixed.push({ kind: 'step', id: PLAN_STEP_ID, at: stepAt, end: stepAt + STEP_MINUTES * MINUTE, running: nowMs >= stepAt, fixed: true });

  const flex: Flex[] = [];
  const taskFlex = (t: Task, carried: boolean, suggested = false): Flex => ({
    carried, item: { kind: 'task', id: t.id, task: t, fixed: false, suggested, at: 0, end: 0, running: false },
  });
  const anyTime: PlanHabit[] = [];
  const passed: Habit[] = [];
  const habitRow = (r: SheetHabit) => {
    if (r.done || skipped.has(r.habit.id)) return;
    const b = blockFor.get(named(r.habit.name));
    const at = b ? ms(b.starts_at) : r.at;
    if (at === null) {
      anyTime.push({ kind: 'habit', id: r.habit.id, habit: r.habit, fixed: false, anyTime: true, at: 0, end: 0, running: false });
      return;
    }
    const end = b ? ms(b.ends_at) : at + HABIT_MINUTES * MINUTE;
    // Its block or time has passed: it leaves the plan quietly and never comes back as a job, but it can still be ticked (call G, R4Y02).
    if (end <= nowMs) { passed.push(r.habit); return; }
    fixed.push({ kind: 'habit', id: r.habit.id, habit: r.habit, fixed: true, anyTime: false, at, end, running: at <= nowMs });
  };
  for (const r of sheet.today) {
    if (r.kind === 'task' && !r.done && !held(r)) {
      // A timed task runs for its length, so one set inside a running block still takes Now, the way a meeting does (R4Y08).
      if (r.at !== null && r.at + minutes(r.task) * MINUTE > nowMs) {
        fixed.push({ kind: 'task', id: r.task.id, task: r.task, fixed: true, suggested: false, at: r.at, end: r.at + minutes(r.task) * MINUTE, running: r.at <= nowMs });
      } else flex.push(taskFlex(r.task, r.at !== null));
    } else if (r.kind === 'habit') habitRow(r);
    else if (r.kind === 'reminder' && !r.struck && r.at >= cut && !(stepDue && named(r.reminder.title) === named(STEP_NAME))) {
      marks.push({ kind: 'mark', id: r.reminder.id, reminder: r.reminder, at: r.at, end: r.at, running: false, fixed: true });
    }
  }
  for (const r of sheet.plan) if (!r.done && !held(r)) flex.push(taskFlex(r.task, false));

  // Free time is always filled: suggestions top the day up to 3 tasks, done or open. Fixed rows, timed tasks too, take no place (call B, R4Y03).
  const doneTasks = [...sheet.today, ...sheet.plan].filter((r) => r.kind === 'task' && r.done).length;
  const target = SUGGEST + skip.more;
  const picked = flex.length;
  const planned = new Set([...flex.map((f) => f.item.id), ...fixed.map((f) => f.id)]);
  const offers = suggestions(sheet, open, today, new Set([...skipped, ...planned]));
  const room = Math.max(0, target - picked - doneTasks);
  for (const t of offers.slice(0, room)) flex.push(taskFlex(t, false, true));

  const queueItems = night ? [] : inOrder(flex, order);
  const rest = queueItems.map((f) => f.item);
  // In the small hours only what is already under way shows.
  const blocks = (smallHours ? fixed.filter((f) => f.running) : fixed).sort((a, b) => a.at - b.at || b.end - a.end);
  const running = blocks.filter((b) => b.running);
  const upcoming = blocks.filter((b) => !b.running);
  const len = (x: PlanTask) => minutes(x.task) * MINUTE;
  const seq: PlanItem[] = [];
  const spare: PlanTask[] = [];
  let cursor = nowMs;
  let now: PlanItem | null = null;

  const place = (x: PlanTask) => {
    if (cursor >= dayEnd || cursor + len(x) > midnight) { spare.push(x); return; }
    seq.push({ ...x, at: cursor, end: cursor + len(x) });
    cursor += len(x);
  };

  if (running.length) {
    // The newest running thing wins Now: a meeting inside a block is what is happening (call J).
    now = running[running.length - 1];
    seq.push(...running.slice(0, -1).reverse());
    cursor = Math.max(nowMs, ...running.map((r) => r.end));
  } else if (!night) {
    const f = upcoming[0];
    const gap = f ? f.at - nowMs : Infinity;
    if (f && gap <= HOLD_MS) now = upcoming.shift() as PlanItem;
    else if (rest.length) {
      // A first task that does not fit the gap gives way to the first one that does, unless it is already under way (call D).
      const fits = (x: PlanTask) => len(x) <= gap;
      const pull = !fits(rest[0]) && rest[0].id !== keep ? rest.findIndex(fits) : -1;
      const [x] = rest.splice(Math.max(pull, 0), 1);
      now = { ...x, at: nowMs, end: nowMs + len(x) };
      cursor = now.end;
    } else if (f && gap <= PLAN_SOON_MS) now = upcoming.shift() as PlanItem;
  }

  while (upcoming.length || rest.length) {
    const f = upcoming[0];
    if (!f) { place(rest.shift() as PlanTask); continue; }
    const gap = f.at - cursor;
    const i = gap >= MIN_GAP_MS ? rest.findIndex((x) => len(x) <= gap) : -1;
    if (i >= 0) place(rest.splice(i, 1)[0]);
    // Nothing fits, but the gap is long: a big job starts here and carries on after the block.
    else if (gap >= PLAN_SOON_MS && rest.length) place(rest.shift() as PlanTask);
    else { upcoming.shift(); seq.push(f); cursor = Math.max(cursor, f.end); }
  }

  // The evening step is a thing to do, not an appointment: free time does not run up to it.
  const firstFixed = seq.find((x) => x.fixed && x.kind !== 'step') ?? null;
  const fixedNext = now && !now.fixed ? firstFixed : null;
  const freeMin = fixedNext ? Math.max(0, Math.round((fixedNext.at - nowMs) / MINUTE)) : null;
  const dated = smallHours ? seq : [...seq, ...marks];
  const rows: PlanRow[] = [...dated.sort((a, b) => a.at - b.at), ...(night ? [] : anyTime)];
  return {
    now, next: seq[0] ?? null, rows, spare, passed, allDay, fixedNext, freeMin, earlier, night,
    queue: queueItems.map((f) => f.item.id),
    freeUntil: !now && !night ? firstFixed : null,
    started: !night && picked === 0 && doneTasks === 0 && flex.length > 0,
    finished: !night && flex.length === 0 && doneTasks >= target,
    canMore: offers.length > 0,
  };
}

const nameOf = (x: PlanItem) => {
  switch (x.kind) {
    case 'task': return x.task.title;
    case 'habit': return x.habit.name;
    case 'event': return x.event.title || 'Busy';
    case 'step': return STEP_NAME;
  }
};
export const planTitle = (x: PlanRow) => (x.kind === 'mark' ? (x.reminder?.title ?? (x.event?.title || 'Busy')) : nameOf(x));

/** Words that read as a command or code: a phone is no place to act on them, so Now leaves them off. The task sheet keeps them (R4Y01). */
const CODE_LIKE = /python|\s--|\.py|\w{4,}\/\w{4,}|\w\/\w+\/\w|\b[a-z0-9]+(?:_[a-z0-9]+){2,}\b/i;
const plainWords = (s: string | null) => (s && !CODE_LIKE.test(s) ? s : null);

/** The line of facts on Now: how long, and the first step. `waiting_on` is what the owner must decide, so it reads as a need (call A). */
export function nowFacts(t: Task): string {
  const step = plainWords(t.next_action);
  const need = plainWords(t.waiting_on);
  const first = step ? `First step: ${step}` : need ? `Needs: ${need}` : '';
  return [t.est_minutes ? spell(t.est_minutes) : '', first].filter(Boolean).join(' · ');
}

/** The line under Now: how long this runs, or how long is free. */
export function nowLine(p: Plan, nowMs: number, time: (ms: number) => string): string {
  const n = p.now;
  if (!n) return '';
  if (n.kind === 'step') return 'Pick what tomorrow starts with.';
  if (n.running) return `Until ${time(n.end)}.`;
  if (n.fixed) {
    const m = Math.max(0, Math.round((n.at - nowMs) / MINUTE));
    return m === 0 ? `Starts now, ${time(n.at)}.` : `Starts at ${time(n.at)}, in ${spell(m)}.`;
  }
  if (p.fixedNext && p.freeMin !== null) return `${spell(p.freeMin)} free, then ${nameOf(p.fixedNext)} at ${time(p.fixedNext.at)}.`;
  return 'Nothing fixed after this today.';
}

/** Now with no task and nothing close: the time is the owner's until the next fixed thing (call C). */
export const freeLine = (x: PlanItem, time: (ms: number) => string) => `Free until ${nameOf(x)} at ${time(x.at)}.`;

/** 95 reads "1 h 35 min". */
export function spell(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
}

/** An estimate shows to the next 5 minutes: it is a guess, and it should not tick by the minute (R4P31, R4U30). */
export const estimateAt = (at: number) => Math.ceil(Math.floor(at / MINUTE) / 5) * 5 * MINUTE;

/** The one line above the plan. Tasks and fixed rows apart, so a lunch never reads as a load (call K). Habits never go to Google, so not "on the calendar" (R4Y10). */
export function headLine(p: Plan, done: number): string {
  const left = [p.now, ...p.rows].filter((r): r is PlanRow => r !== null);
  const tasks = left.filter((r) => r.kind === 'task').length + p.spare.length;
  const set = left.filter((r) => r.kind === 'event' || (r.kind === 'habit' && r.fixed)).length;
  if (p.night && !tasks && !set) return done ? `${done} done today.` : '';
  if (!tasks && !set) return done ? `That is everything for today, ${done} done.` : 'Nothing on today.';
  const parts = [tasks ? `${tasks} to do` : '', set ? `${set} at ${set === 1 ? 'a set time' : 'set times'}` : '', done ? `${done} done` : ''];
  return `${parts.filter(Boolean).join(', ')}.`;
}

/** A day with no room says so plainly, instead of hiding its tasks in a fold (R4P19). */
export function spareText(p: Plan): string | null {
  const n = p.spare.length;
  if (!n || [p.now, ...p.rows].some((r) => r?.kind === 'task')) return null;
  return `No free time today. ${n} task${n === 1 ? ' is' : 's are'} waiting.`;
}

export const NOT_LINKED_LINE = 'Google Calendar is not linked yet. Link it in Settings.';

/** The quiet line about the calendar link. A problem always shows, linked or not (R4P10, R4B06). Null when there is nothing to say. */
export function calendarLine(s: CalendarState | undefined, nowMs: number, time: (ms: number) => string): string | null {
  if (s?.problem) return s.problem;
  if (!s || !s.linked) return NOT_LINKED_LINE;
  const at = s.last_ok_at ? new Date(s.last_ok_at).getTime() : null;
  if (at === null) return 'Google Calendar is linked. Waiting for the first check.';
  return nowMs - at > 30 * MINUTE ? `Google Calendar last checked ${nowMs - at > 86_400_000 ? dayMonth(new Date(at).toISOString().slice(0, 10)) : time(at)}.` : null;
}

export type Laned<T> = T & { lane: number; lanes: number };

/**
 * Side-by-side columns for the day panel (R4U11): by start, each block takes the first free lane, and every block in an
 * overlapping group shares that group's lane count.
 */
export function laneBlocks<T extends { at: number; end: number }>(blocks: T[]): Laned<T>[] {
  const out: Laned<T>[] = [];
  let group: Laned<T>[] = [];
  let ends: number[] = [];
  const close = () => { for (const b of group) b.lanes = ends.length; group = []; ends = []; };
  for (const b of [...blocks].sort((x, y) => x.at - y.at || y.end - x.end)) {
    if (ends.length && b.at >= Math.max(...ends)) close();
    let lane = ends.findIndex((e) => e <= b.at);
    if (lane < 0) lane = ends.length;
    ends[lane] = b.end;
    const row = { ...b, lane, lanes: 1 };
    group.push(row);
    out.push(row);
  }
  close();
  return out;
}
