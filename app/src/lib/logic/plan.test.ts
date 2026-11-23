import { describe, expect, it } from 'vitest';
import { istTime, istToMs } from '../../shared/ist';
import { baseTask } from '../data/fixtures';
import type { CalendarEvent, Habit, Reminder, Task } from '../types';
import { buildPlan, calendarLine, estimateAt, eventsOn, freeLine, headLine, laneBlocks, nowFacts, nowLine, PLAN_STEP_ID, planTitle, spareText, spell, type PlanInput, type PlanRow } from './plan';
import { buildSheet } from './today';

const DAY = '2026-11-09';
const at = (hhmm: string) => istToMs(DAY, hhmm);
const task = (title: string, over: Partial<Task> = {}) => baseTask({ title, ...over }, at('08:00')) as unknown as Task;
const pick = (title: string, over: Partial<Task> = {}) => task(title, { planned_for: DAY, ...over });
const old = (title: string, over: Partial<Task> = {}) => task(title, { due_date: '2026-11-01', ...over });
let n = 0;
const ev = (title: string, from: string, to: string, over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: `e${++n}`, title, starts_at: new Date(at(from)).toISOString(), ends_at: new Date(at(to)).toISOString(),
  all_day_from: null, all_day_to: null, busy: true, html_link: null, meet_link: null, task_id: null, ...over,
});
const habit = (name: string, time: string | null = null): Habit => ({ id: `h-${name}`, name, area: 'personal', days: [0, 1, 2, 3, 4, 5, 6], time_local: time, active: true, sort_order: 0, created_at: '' });
const reminder = (title: string, time: string): Reminder => ({
  id: `r-${title}`, title, notes: null, area: 'work', remind_at: null, time_local: time, repeat: 'daily', repeat_days: [], active: true,
  last_fired_at: null, task_id: null, snooze_of: null, created_at: '', updated_at: '',
});

type Opts = Partial<Pick<PlanInput, 'order' | 'skip' | 'tomorrowPicked' | 'keep'>> & { reminders?: Reminder[]; claude?: Set<string>; habits?: Habit[]; habitDone?: Set<string>; done?: Task[] };
function plan(nowHm: string, tasks: Task[], events: CalendarEvent[] = [], o: Opts = {}) {
  const nowMs = at(nowHm);
  const sheet = buildSheet({
    open: tasks, reminders: o.reminders ?? [], unread: [], today: DAY, nowMs, pickOrder: o.order, claudeTasks: o.claude,
    habits: o.habits, habitDone: o.habitDone, doneToday: o.done,
  });
  return buildPlan({ sheet, nowMs, today: DAY, events, open: tasks, order: o.order, skip: o.skip, tomorrowPicked: o.tomorrowPicked, keep: o.keep });
}
const titles = (p: ReturnType<typeof plan>) => [p.now, ...p.rows].filter(Boolean).map((x) => planTitle(x as PlanRow));
const doneTask = (title: string) => task(title, { status: 'done', planned_for: DAY, completed_at: new Date(at('08:30')).toISOString() });

describe('the war room plan', () => {
  it('runs a meeting that is on now as Now, and the first pick after it', () => {
    const p = plan('12:10', [pick('Write proposal')], [ev('Lunch', '12:00', '13:00')]);
    expect(planTitle(p.now!)).toBe('Lunch');
    expect(p.now!.running).toBe(true);
    expect(planTitle(p.next!)).toBe('Write proposal');
    expect(p.next!.at).toBe(at('13:00'));
  });

  it('fits a task before a meeting when there is room', () => {
    const p = plan('10:00', [pick('Write proposal', { est_minutes: 30 })], [ev('Call', '11:00', '11:30')]);
    expect(titles(p)).toEqual(['Write proposal', 'Call']);
    expect(p.freeMin).toBe(60);
    expect(nowLine(p, at('10:00'), istTime)).toBe('1 h free, then Call at 11:00.');
  });

  it('starts a long task when the next meeting is far off', () => {
    const p = plan('09:00', [pick('Long job', { est_minutes: 120 })], [ev('Call', '10:00', '10:30')]);
    expect(planTitle(p.now!)).toBe('Long job');
  });

  it('keeps the picks in their saved order, across work and personal', () => {
    const a = pick('Work thing');
    const b = pick('Home thing', { area: 'personal' });
    const p = plan('09:00', [a, b], [], { order: [b.id, a.id] });
    expect(titles(p)).toEqual(['Home thing', 'Work thing']);
  });

  it('never says late: a task whose time passed just goes first', () => {
    const t = task('Send invoice', { due_date: DAY, due_time: '08:00', planned_for: DAY });
    const p = plan('10:00', [pick('Other'), t]);
    expect(planTitle(p.now!)).toBe('Send invoice');
    expect(p.now!.fixed).toBe(false);
  });

  it('not now: the saved order wins, even over a task whose time passed', () => {
    const t = task('Send invoice', { due_date: DAY, due_time: '08:00', planned_for: DAY });
    const o = pick('Other');
    const p = plan('10:00', [o, t], [], { order: [o.id, t.id] });
    expect(titles(p).slice(0, 2)).toEqual(['Other', 'Send invoice']);
    expect(p.queue.slice(0, 2)).toEqual([o.id, t.id]);
  });

  it('a timed task is fixed like a meeting', () => {
    const t = task('Pay rent', { due_date: DAY, due_time: '15:00' });
    const p = plan('09:00', [pick('Write'), t]);
    expect(titles(p)).toEqual(['Write', 'Pay rent']);
    expect(p.next!.fixed).toBe(true);
    expect(p.next!.at).toBe(at('15:00'));
  });

  it('shows the task, not its calendar copy', () => {
    const t = task('Pay rent', { due_date: DAY, due_time: '15:00' });
    const p = plan('14:58', [t], [ev('Pay rent', '15:00', '15:30', { task_id: t.id })]);
    expect(titles(p)).toEqual(['Pay rent']);
    expect(p.now!.kind).toBe('task');
  });

  it('a Free event is a mark: it shows at its time but is never Now', () => {
    const p = plan('09:00', [], [ev('Gym ready', '14:15', '14:30', { busy: false })]);
    expect(p.now).toBeNull();
    expect(p.rows.map(planTitle)).toEqual(['Gym ready']);
  });

  it('a long event is a backdrop, so it never holds Now all day', () => {
    const p = plan('10:00', [pick('Write')], [ev('Office', '09:00', '18:00')]);
    expect(planTitle(p.now!)).toBe('Write');
    expect(p.allDay.map((e) => e.title)).toEqual(['Office']);
  });

  it('ended events leave the plan', () => {
    const p = plan('15:00', [pick('Write')], [ev('Call', '09:00', '09:30')]);
    expect(titles(p)).toEqual(['Write']);
    expect(p.earlier.map((e) => e.title)).toEqual(['Call']);
  });

  it('overlapping meetings both show, and the plan waits for the later end', () => {
    const p = plan('09:00', [pick('Write')], [ev('A', '09:30', '10:30'), ev('B', '10:00', '10:15')]);
    expect(titles(p)).toEqual(['Write', 'A', 'B']);
  });

  it('a habit and a calendar block with the same name show once, at the block time', () => {
    const p = plan('21:10', [], [ev('walk ', '21:30', '22:00')], { habits: [habit('Walk')] });
    expect(p.now!.kind).toBe('habit');
    expect(p.now!.at).toBe(at('21:30'));
    expect(p.rows).toHaveLength(0);
  });

  it('skips tasks with Claude, and they are never suggested', () => {
    const a = pick('Held');
    const b = old('Also held');
    const p = plan('09:00', [a, b, pick('Mine')], [], { claude: new Set([a.id, b.id]) });
    expect(titles(p)).toEqual(['Mine']);
  });
});

describe('call A: waiting_on does not block a task', () => {
  it('suggests a task whose waiting_on holds what the owner must decide', () => {
    const p = plan('09:30', [task('Launch plan', { waiting_on: 'a go or stop', next_action: null })]);
    expect(planTitle(p.now!)).toBe('Launch plan');
  });
  it('shows the first step, or what it needs, on Now', () => {
    expect(nowFacts(task('A', { next_action: 'Write it', waiting_on: 'a price', est_minutes: 90 }))).toBe('1 h 30 min · First step: Write it');
    expect(nowFacts(task('A', { waiting_on: 'a price' }))).toBe('Needs: a price');
    expect(nowFacts(task('A'))).toBe('');
  });
  it('keeps a plain decision with a slash in it, as the live notes have', () => {
    for (const waiting_on of ['a go/kill on the plan', 'a go/no-go before a proposal', 'Say yes/no']) expect(nowFacts(task('A', { waiting_on }))).toBe(`Needs: ${waiting_on}`);
  });
  it('leaves a command or code off Now, and shows nothing for it (R4Y01)', () => {
    for (const next_action of [
      'python3 invoice.py --client northwind --month 2026-09 --draft (then 2026-10)', 'run python here', 'Agent: check model id in daily_campaign_summary/classifier.py',
      'npm run build --force', 'open classifier.py', 'look in data/credentials', 'check regional_accounting_master_wi_mi_oh',
    ]) expect(nowFacts(task('A', { next_action }))).toBe('');
  });
  it('checks each field on its own: a command as the step falls through to the need, and a command as the need is dropped', () => {
    expect(nowFacts(task('A', { next_action: 'python3 invoice.py', waiting_on: 'you run the invoice tool', est_minutes: 10 }))).toBe('10 min · Needs: you run the invoice tool');
    expect(nowFacts(task('A', { next_action: 'python3 invoice.py', waiting_on: 'see db/seed_initial.py' }))).toBe('');
    expect(nowFacts(task('A', { waiting_on: 'daily_campaign_summary', est_minutes: 90 }))).toBe('1 h 30 min');
  });
  it('keeps plain words, with their hyphens, dashes and short names', () => {
    expect(nowFacts(task('A', { next_action: "Say 'cross-check vs sent list, then queue' (or drop it)" }))).toBe("First step: Say 'cross-check vs sent list, then queue' (or drop it)");
    expect(nowFacts(task('A', { next_action: 'Update .env and the copy_lint notes' }))).toBe('First step: Update .env and the copy_lint notes');
    expect(nowFacts(task('A', { waiting_on: 'resume / kill decision' }))).toBe('Needs: resume / kill decision');
  });
});

describe('call B: free time is always filled', () => {
  const four = () => ['A', 'B', 'C', 'D'].map((x) => task(x));
  it('tops the day up to 3 tasks, however many fixed rows exist', () => {
    const p = plan('09:00', four(), [ev('Lunch', '12:00', '13:00'), ev('Call', '15:00', '15:30')]);
    expect(p.queue).toHaveLength(3);
    expect(planTitle(p.now!)).toBe('A');
  });
  it('a timed task takes no place from the suggestions (R4Y03)', () => {
    const t = task('Call Sam', { due_date: DAY, due_time: '15:00' });
    const p = plan('09:30', [t, ...four()]);
    expect(p.queue).toHaveLength(3);
    expect(titles(p)).toEqual(['A', 'B', 'C', 'Call Sam']);
  });
  it('three timed tasks for later leave the morning full, not "Free until" (R4Y03)', () => {
    const timed = ['13:00', '15:00', '17:00'].map((h, i) => task(`Timed ${i}`, { due_date: DAY, due_time: h }));
    const p = plan('09:30', [...timed, ...four()]);
    expect(planTitle(p.now!)).toBe('A');
    expect(p.freeUntil).toBeNull();
    expect(p.queue).toHaveLength(3);
  });
  it('counts what is done today, so the day ends at 3', () => {
    const p = plan('09:00', four(), [], { done: [doneTask('X'), doneTask('Y')] });
    expect(p.queue).toHaveLength(1);
  });
  it('orders older by priority, then undated by priority and oldest touch', () => {
    const p = plan('09:00', [
      task('Undated new', { updated_at: '2026-11-08T00:00:00Z' }), task('Undated old', { updated_at: '2026-10-01T00:00:00Z' }),
      task('Undated high', { priority: 1, updated_at: '2026-11-08T00:00:00Z' }), old('Old low', { priority: 3 }), old('Old high', { priority: 1 }),
    ]);
    expect(titles(p)).toEqual(['Old high', 'Old low', 'Undated high']);
  });
  it('picks count too, and suggestions come after them', () => {
    const p = plan('09:00', [pick('Mine'), ...four()]);
    expect(titles(p)).toEqual(['Mine', 'A', 'B']);
    expect(p.started).toBe(false);
  });
  it('says it started the day only when nothing is picked', () => {
    expect(plan('09:00', four()).started).toBe(true);
    expect(plan('09:00', [pick('Mine')]).started).toBe(false);
  });
  it('after the first task is done the day is under way, so it no longer says nothing is picked (R4Y11)', () => {
    expect(plan('09:00', four(), [], { done: [doneTask('X')] }).started).toBe(false);
  });
  it('never offers a task planned for a later day', () => {
    expect(plan('09:00', [task('Later', { planned_for: '2026-11-12' })]).now).toBeNull();
  });
});

describe('call C: Now holds', () => {
  it('a task stays Now until the fixed thing is within 5 minutes', () => {
    const t = pick('Write', { est_minutes: 30 });
    const lunch = ev('Lunch', '12:00', '13:00');
    expect(planTitle(plan('11:31', [t], [lunch]).now!)).toBe('Write');
    expect(planTitle(plan('11:54', [t], [lunch]).now!)).toBe('Write');
    expect(nowLine(plan('11:54', [t], [lunch]), at('11:54'), istTime)).toBe('6 min free, then Lunch at 12:00.');
    expect(planTitle(plan('11:55', [t], [lunch]).now!)).toBe('Lunch');
  });
  it('with no task, a fixed thing is Now only inside 30 minutes', () => {
    const call = ev('Client call', '11:30', '12:00');
    const near = plan('11:00', [], [call]);
    expect(planTitle(near.now!)).toBe('Client call');
    expect(nowLine(near, at('11:00'), istTime)).toBe('Starts at 11:30, in 30 min.');
    const far = plan('09:30', [], [call]);
    expect(far.now).toBeNull();
    expect(freeLine(far.freeUntil!, istTime)).toBe('Free until Client call at 11:30.');
    expect(planTitle(far.next!)).toBe('Client call');
  });
});

describe('call D: small gaps', () => {
  const block = ev('Bath', '16:15', '16:45');
  it('pulls forward the first task that fits the gap', () => {
    const p = plan('16:00', [pick('Big', { est_minutes: 30 }), pick('Small', { est_minutes: 5 })], [block]);
    expect(titles(p)).toEqual(['Small', 'Bath', 'Big']);
  });
  it('the task already under way is not swapped when the gap shrinks', () => {
    const big = pick('Big', { est_minutes: 30 });
    const p = plan('16:00', [big, pick('Small', { est_minutes: 5 })], [block], { keep: big.id });
    expect(planTitle(p.now!)).toBe('Big');
  });
  it('a gap under 15 minutes after Now is left empty', () => {
    const p = plan('16:00', [pick('A', { est_minutes: 5 }), pick('B', { est_minutes: 5 })], [block]);
    expect(titles(p)).toEqual(['A', 'Bath', 'B']);
    const q = plan('15:30', [pick('A', { est_minutes: 5 }), pick('B', { est_minutes: 5 })], [block]);
    expect(titles(q)).toEqual(['A', 'B', 'Bath']);
  });
  it('fills a later gap with the first task that fits', () => {
    const p = plan('09:00', [pick('A', { est_minutes: 30 }), pick('Big', { est_minutes: 60 }), pick('Small', { est_minutes: 20 })], [ev('Call', '10:00', '10:30')]);
    expect(titles(p)).toEqual(['A', 'Small', 'Call', 'Big']);
  });
  it('a full day says so instead of hiding the tasks', () => {
    const wall = Array.from({ length: 18 }, (_, i) => ev(`Block ${i}`, `${String(5 + i).padStart(2, '0')}:00`, `${String(6 + i).padStart(2, '0')}:00`));
    const p = plan('09:30', [pick('One'), pick('Two')], wall, { keep: null });
    expect(p.now?.kind).toBe('event');
    expect(spareText(p)).toBe('No free time today. 2 tasks are waiting.');
    expect(spareText(plan('09:30', [pick('One')]))).toBeNull();
  });
});

describe('call E: one skip list for the day', () => {
  it('a skipped suggestion lets the next one in, and task 4 can be reached', () => {
    const [a, b, c, d] = ['A', 'B', 'C', 'D'].map((x) => task(x));
    expect(titles(plan('09:00', [a, b, c, d], [], { skip: { ids: [a.id], more: 0 } }))).toEqual(['B', 'C', 'D']);
  });
  it('a skipped habit leaves the plan', () => {
    const p = plan('13:00', [], [], { habits: [habit('Food log', '13:00')], skip: { ids: ['h-Food log'], more: 0 } });
    expect(p.now).toBeNull();
    expect(p.rows).toHaveLength(0);
  });
  it('an event finished early leaves Now, and it never touches the event', () => {
    const lunch = ev('Lunch', '12:00', '13:00');
    const p = plan('12:30', [pick('Write')], [lunch], { skip: { ids: [lunch.id], more: 0 } });
    expect(planTitle(p.now!)).toBe('Write');
    expect(p.earlier).toEqual([lunch]);
  });
  it('a pick in the skip list stays: Not now on a pick only moves it', () => {
    const a = pick('Mine');
    expect(planTitle(plan('09:00', [a], [], { skip: { ids: [a.id], more: 0 } }).now!)).toBe('Mine');
  });
});

describe('call F: a finish line', () => {
  const left = () => [task('Left')];
  const three = () => [doneTask('X'), doneTask('Y'), doneTask('Z')];
  it('after 3 done it stops, and One more is on offer', () => {
    const p = plan('10:00', left(), [], { done: three() });
    expect(p.now).toBeNull();
    expect(p.finished).toBe(true);
    expect(p.canMore).toBe(true);
  });
  it('One more lets one more task in', () => {
    const p = plan('10:00', left(), [], { done: three(), skip: { ids: [], more: 1 } });
    expect(planTitle(p.now!)).toBe('Left');
    expect(p.finished).toBe(false);
  });
  it('a timed task still to come does not hold back the finish line (R4Y03)', () => {
    const p = plan('10:00', [...left(), task('Call Sam', { due_date: DAY, due_time: '15:00' })], [], { done: three() });
    expect(p.finished).toBe(true);
    expect(p.canMore).toBe(true);
    expect(freeLine(p.freeUntil!, istTime)).toBe('Free until Call Sam at 15:00.');
  });
  it('with nothing left to offer there is no One more', () => {
    const p = plan('10:00', [], [], { done: three() });
    expect(p.finished).toBe(true);
    expect(p.canMore).toBe(false);
  });
  it('fewer than 3 done is not the finish line', () => {
    expect(plan('10:00', [], [], { done: [doneTask('X')] }).finished).toBe(false);
  });
});

describe('call G: habits', () => {
  const gym = () => [habit('Gym', '14:15')];
  const block = () => [ev('Gym', '14:30', '16:00')];
  it('a timed habit is fixed at its time', () => {
    const p = plan('09:00', [pick('A')], [], { habits: [habit('Food log', '13:00')] });
    expect(p.next!.fixed).toBe(true);
    expect(p.next!.at).toBe(at('13:00'));
  });
  it('a habit shows until its block ends, then leaves quietly', () => {
    expect(planTitle(plan('15:10', [], block(), { habits: gym() }).now!)).toBe('Gym');
    const p = plan('16:01', [pick('A')], block(), { habits: gym() });
    expect(titles(p)).toEqual(['A']);
  });
  it('a timed habit with no block leaves when its time has passed', () => {
    expect(titles(plan('18:30', [], [], { habits: [habit('Food log', '13:00')] }))).toEqual([]);
  });
  it('a habit whose time has ended waits to be ticked, off the plan (R4Y02)', () => {
    const p = plan('16:02', [pick('A')], block(), { habits: gym() });
    expect(p.passed.map((h) => h.name)).toEqual(['Gym']);
    expect(p.rows.some((r) => r.kind === 'habit')).toBe(false);
    expect(planTitle(p.now!)).toBe('A');
    expect(plan('19:30', [], [], { habits: [habit('Flute', '19:00')] }).passed.map((h) => h.name)).toEqual(['Flute']);
  });
  it('a habit not over yet, skipped, ticked or with no time is not waiting to be ticked (R4Y02)', () => {
    expect(plan('15:10', [], block(), { habits: gym() }).passed).toEqual([]);
    expect(plan('19:30', [], [], { habits: [habit('Flute', '19:00')], skip: { ids: ['h-Flute'], more: 0 } }).passed).toEqual([]);
    expect(plan('19:30', [], [], { habits: [habit('Flute', '19:00')], habitDone: new Set(['h-Flute']) }).passed).toEqual([]);
    expect(plan('19:30', [], [], { habits: [habit('Read')] }).passed).toEqual([]);
  });
  it('it still waits at night, when the plan is empty (R4Y02)', () => {
    const p = plan('23:30', [], [], { habits: [habit('Flute', '19:00')] });
    expect(p.night).toBe(true);
    expect(p.rows).toHaveLength(0);
    expect(p.passed.map((h) => h.name)).toEqual(['Flute']);
  });
  it('an untimed habit is a row at the end, never Now or Next', () => {
    const p = plan('09:00', [pick('A', { est_minutes: 30 })], [ev('Call', '15:00', '15:30')], { habits: [habit('Read')] });
    expect(titles(p)).toEqual(['A', 'Call', 'Read']);
    expect(p.next!.kind).toBe('event');
    expect(p.rows.at(-1)).toMatchObject({ kind: 'habit', anyTime: true });
    const alone = plan('09:00', [], [], { habits: [habit('Read')] });
    expect(alone.now).toBeNull();
    expect(alone.next).toBeNull();
    expect(alone.rows).toHaveLength(1);
  });
  it('a ticked habit is gone', () => {
    expect(titles(plan('09:00', [], [], { habits: [habit('Read')], habitDone: new Set(['h-Read']) }))).toEqual([]);
  });
});

describe('call H: Plan tomorrow is a step', () => {
  it('is a fixed row at 21:00 while nothing is picked for tomorrow', () => {
    const p = plan('09:00', [pick('A')], [], { tomorrowPicked: 0 });
    expect(p.rows.at(-1)).toMatchObject({ kind: 'step', at: at('21:00'), fixed: true });
    expect(titles(plan('09:00', [pick('A')], [], { tomorrowPicked: 1 }))).toEqual(['A']);
  });
  it('can be Now from 21:00, with its own line', () => {
    const p = plan('21:10', [pick('A')], [], { tomorrowPicked: 0 });
    expect(p.now!.kind).toBe('step');
    expect(nowLine(p, at('21:10'), istTime)).toBe('Pick what tomorrow starts with.');
  });
  it('a running event wins, and the step comes back when it ends', () => {
    const walk = ev('Stroll', '21:30', '22:00');
    expect(planTitle(plan('21:40', [], [walk], { tomorrowPicked: 0 }).now!)).toBe('Stroll');
    expect(plan('22:05', [], [walk], { tomorrowPicked: 0 }).now!.kind).toBe('step');
  });
  it('a reminder of the same title does not also show', () => {
    const r = [reminder('Plan tomorrow', '21:15')];
    expect(titles(plan('09:00', [], [], { tomorrowPicked: 0, reminders: r }))).toEqual(['Plan tomorrow']);
    expect(titles(plan('09:00', [], [], { tomorrowPicked: 2, reminders: r }))).toEqual(['Plan tomorrow']);
    expect(plan('09:00', [], [], { tomorrowPicked: 0, reminders: r }).rows[0].kind).toBe('step');
    expect(plan('09:00', [], [], { tomorrowPicked: 2, reminders: r }).rows[0].kind).toBe('mark');
  });
  it('Not now takes it off for tonight', () => {
    expect(plan('21:10', [], [], { tomorrowPicked: 0, skip: { ids: [PLAN_STEP_ID], more: 0 } }).now).toBeNull();
  });
  it('Not now does not bring the reminder of the same title back (R4Y17)', () => {
    const p = plan('21:10', [], [], { tomorrowPicked: 0, skip: { ids: [PLAN_STEP_ID], more: 0 }, reminders: [reminder('Plan tomorrow', '21:15')] });
    expect(p.now).toBeNull();
    expect(p.rows).toHaveLength(0);
  });
});

describe('call I: the day ends', () => {
  it('from 23:00 no task is Now, and no row is offered', () => {
    const p = plan('23:30', [pick('One'), old('Two')], [], { habits: [habit('Read')], tomorrowPicked: 0 });
    expect(p.night).toBe(true);
    expect(p.now).toBeNull();
    expect(p.rows).toHaveLength(0);
    expect(p.queue).toHaveLength(0);
    expect(p.spare).toHaveLength(0);
  });
  it('a running event still shows at night', () => {
    expect(planTitle(plan('23:30', [pick('One')], [ev('Late call', '23:00', '23:45')]).now!)).toBe('Late call');
  });
  it('before 05:00 it stays quiet, with nothing from the day ahead', () => {
    const p = plan('00:30', [pick('One')], [ev('Lunch', '12:00', '13:00')], { reminders: [reminder('Morning look', '08:30')], tomorrowPicked: 0 });
    expect(p.night).toBe(true);
    expect(p.now).toBeNull();
    expect(p.rows).toHaveLength(0);
  });
  it('05:00 is a new day', () => {
    expect(planTitle(plan('05:00', [pick('One')]).now!)).toBe('One');
  });
  it('rows never start after 23:00 and never run past midnight', () => {
    const p = plan('22:40', [pick('One', { est_minutes: 30 }), pick('Two', { est_minutes: 30 })]);
    expect(planTitle(p.now!)).toBe('One');
    expect(p.spare.map((x) => x.task.title)).toEqual(['Two']);
    const q = plan('22:00', [pick('Head', { est_minutes: 30 }), pick('Long', { est_minutes: 120 })]);
    expect(q.spare.map((x) => x.task.title)).toEqual(['Long']);
  });
});

describe('call J: running things and order', () => {
  it('the newest running event wins Now, and the older one is next', () => {
    const p = plan('12:05', [], [ev('Focus block', '11:00', '13:00'), ev('Client call', '12:00', '12:30')]);
    expect(planTitle(p.now!)).toBe('Client call');
    expect(planTitle(p.next!)).toBe('Focus block');
  });
  it('a running habit says until when, in the middle of its block', () => {
    const p = plan('15:10', [], [ev('Gym', '14:30', '16:00')], { habits: [habit('Gym', '14:15')] });
    expect(nowLine(p, at('15:10'), istTime)).toBe('Until 16:00.');
  });
  it('spells long waits', () => {
    const p = plan('09:00', [pick('A')], [ev('Call', '10:35', '11:00')]);
    expect(nowLine(p, at('09:00'), istTime)).toBe('1 h 35 min free, then Call at 10:35.');
  });
  it('a timed task inside a running block takes Now for its length, then goes first in the list (R4Y08)', () => {
    const gym = ev('Gym block', '14:30', '16:00');
    const t = task('Call Sam', { due_date: DAY, due_time: '15:00' });
    const on = plan('15:02', [t], [gym]);
    expect(planTitle(on.now!)).toBe('Call Sam');
    expect(on.now!.running).toBe(true);
    expect(nowLine(on, at('15:02'), istTime)).toBe('Until 15:30.');
    expect(on.next).toMatchObject({ kind: 'event', running: true });
    expect(planTitle(plan('15:30', [t], [gym]).now!)).toBe('Gym block');
  });
  it('a timed task past its length is a plain task again, never late (R4Y08)', () => {
    const p = plan('10:00', [task('Send invoice', { due_date: DAY, due_time: '08:00', planned_for: DAY })]);
    expect(p.now).toMatchObject({ kind: 'task', fixed: false, running: false });
  });
  it('marks sort with Next: one list by time', () => {
    const p = plan('07:00', [], [ev('Lunch', '12:00', '13:00')], { reminders: [reminder('Morning look', '08:30')] });
    expect(p.rows.map(planTitle)).toEqual(['Morning look', 'Lunch']);
    expect(planTitle(p.next!)).toBe('Lunch');
  });
});

describe('call K: the head line', () => {
  it('counts tasks and calendar rows apart, and marks not at all', () => {
    const p = plan('09:00', [pick('One'), pick('Two')], [ev('Lunch', '12:00', '13:00')], { reminders: [reminder('Stretch', '10:00')], habits: [habit('Gym', '14:00'), habit('Read')] });
    expect(headLine(p, 1)).toBe('2 to do, 2 at set times, 1 done.');
  });
  it('says the rest plainly', () => {
    expect(headLine(plan('09:00', [pick('One')]), 0)).toBe('1 to do.');
    expect(headLine(plan('09:00', [], [ev('Lunch', '12:00', '13:00')]), 0)).toBe('1 at a set time.');
    expect(headLine(plan('09:00', []), 0)).toBe('Nothing on today.');
    expect(headLine(plan('09:00', []), 2)).toBe('That is everything for today, 2 done.');
    expect(headLine(plan('23:30', []), 2)).toBe('2 done today.');
    expect(headLine(plan('00:30', []), 0)).toBe('');
  });
});

describe('calendar helpers', () => {
  it('finds all-day events across their days, with the end day left out', () => {
    const e = ev('Trip', '00:00', '00:00', { starts_at: null, ends_at: null, all_day_from: DAY, all_day_to: '2026-11-11' });
    expect(eventsOn([e], DAY).allDay).toHaveLength(1);
    expect(eventsOn([e], '2026-11-10').allDay).toHaveLength(1);
    expect(eventsOn([e], '2026-11-11').allDay).toHaveLength(0);
  });
  it('finds a timed event that began earlier and runs into the day, not one that ended before it (R4X11)', () => {
    const conf = ev('Conference', '09:00', '18:00', { starts_at: new Date(at('09:00') - 2 * 86_400_000).toISOString(), ends_at: new Date(at('18:00') + 86_400_000).toISOString() });
    const gone = ev('Over', '09:00', '10:00', { starts_at: new Date(at('09:00') - 86_400_000).toISOString(), ends_at: new Date(at('10:00') - 86_400_000).toISOString() });
    expect(eventsOn([conf, gone], DAY).timed).toEqual([conf]);
    expect(plan('10:00', [pick('Write')], [conf]).allDay).toEqual([conf]);
    expect(planTitle(plan('10:00', [pick('Write')], [conf]).now!)).toBe('Write');
  });
  it('a call over midnight is still Now in the small hours (R4X11)', () => {
    const late = ev('Late call', '00:00', '00:45', { starts_at: new Date(at('00:00') - 30 * 60_000).toISOString() });
    expect(planTitle(plan('00:10', [], [late]).now!)).toBe('Late call');
  });
  it('says nothing while the link is fine', () => {
    const s = { id: true, linked: true, last_ok_at: new Date(at('09:58')).toISOString(), problem: null };
    expect(calendarLine(s, at('10:00'), istTime)).toBeNull();
    expect(calendarLine({ ...s, problem: 'Sign in again.' }, at('10:00'), istTime)).toBe('Sign in again.');
    expect(calendarLine(s, at('11:00'), istTime)).toBe('Google Calendar last checked 09:58.');
  });
  it('says it is not linked, and where to fix that (R4Y10)', () => {
    expect(calendarLine(undefined, at('10:00'), istTime)).toBe('Google Calendar is not linked yet. Link it in Settings.');
  });
  it('shows a problem even while not linked', () => {
    expect(calendarLine({ id: true, linked: false, last_ok_at: null, problem: 'Google said no.' }, at('10:00'), istTime)).toBe('Google said no.');
  });
  it('spells minutes', () => {
    expect([spell(45), spell(60), spell(95)]).toEqual(['45 min', '1 h', '1 h 35 min']);
  });
  it('rounds a shown estimate up to 5 minutes, and leaves a round time alone', () => {
    expect(istTime(estimateAt(at('09:21')))).toBe('09:25');
    expect(istTime(estimateAt(at('09:25')))).toBe('09:25');
  });
});

describe('day panel lanes', () => {
  const b = (id: string, from: string, to: string) => ({ id, at: at(from), end: at(to) });
  it('puts overlapping blocks side by side, and shares the count in the group', () => {
    const out = laneBlocks([b('lunch', '12:00', '13:00'), b('food', '12:30', '12:45'), b('gym', '14:00', '15:00')]);
    expect(out.map((x) => [x.id, x.lane, x.lanes])).toEqual([['lunch', 0, 2], ['food', 1, 2], ['gym', 0, 1]]);
  });
  it('reuses a free lane inside a group', () => {
    const out = laneBlocks([b('a', '09:00', '12:00'), b('b', '09:00', '10:00'), b('c', '10:00', '11:00')]);
    expect(out.map((x) => [x.id, x.lane, x.lanes])).toEqual([['a', 0, 2], ['b', 1, 2], ['c', 1, 2]]);
  });
  it('blocks that only touch do not share', () => {
    expect(laneBlocks([b('a', '09:00', '10:00'), b('b', '10:00', '11:00')]).map((x) => x.lanes)).toEqual([1, 1]);
  });
});
