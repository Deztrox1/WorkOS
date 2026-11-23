import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { CalendarDays, ChevronDown, ChevronRight, ClipboardCheck, Video } from 'lucide-react';
import { useAdd } from '../components/AddMenu';
import { useReminderSheet } from '../components/ReminderSheet';
import { AlertRow, ClaudeLine, FlagRow } from '../components/SheetRows';
import { Stamp } from '../components/Stamp';
import { rowState, TaskCheck, TaskSide, TaskText, useIsPhone, type RowAction } from '../components/TaskRow';
import { useTaskSheet } from '../components/TaskSheet';
import { Check, ListState } from '../components/ui';
import { completeTask, followedUp, moveTask, oneMore, reminderDone, reorderPlan, setTaskDone, skipToday, tickHabit, tickReminder, toggleHabitDay } from '../lib/actions';
import { linkAllowed, safeOpen } from '../lib/claude';
import { longDate, greeting } from '../lib/logic/format';
import { buildPlan, calendarLine, estimateAt, freeLine, headLine, laneBlocks, NOT_LINKED_LINE, nowFacts, nowLine, planTitle, spareText, spell, type Plan, type PlanItem, type PlanRow } from '../lib/logic/plan';
import { isFollowUp } from '../lib/logic/tasks';
import { closingLine, isEvening, sheetName } from '../lib/logic/today';
import { useOnline } from '../lib/online';
import { useSlice } from '../lib/store';
import type { CalendarEvent, Task } from '../lib/types';
import { useDay } from '../lib/useDay';
import { istDate, istParts, istTime, istToMs } from '../shared/ist';

/** The tag that says which half of the day a row belongs to. A day of one area needs no tag on every row. */
const Area = ({ task }: { task: Task }) => <span className={`area-tag ${task.area}`}>{task.area}</span>;

/** A link from Google shows only when it is one the calendar may store: no button that does nothing. */
const calendarLink = (url: string | null) => linkAllowed(url, 'calendar');

/** Times and lengths inside a sentence are mono, like every other number (R4U32). */
const NUMBERS = /(\d{1,2}:\d{2}|\d+ h(?: \d+ min)?|\d+ min)/;
const Numbers = ({ text }: { text: string }) => <>{text.split(NUMBERS).map((part, i) => (i % 2 ? <span key={i} className="mono">{part}</span> : part))}</>;

/** Open a calendar row in Google Calendar, and offer the meeting link when it has one. */
function EventLinks({ e, big = false }: { e: CalendarEvent; big?: boolean }) {
  const size = big ? 'btn' : 'btn sm';
  return (
    <>
      {calendarLink(e.meet_link) && <button type="button" className={`${size} ${big ? 'primary' : ''}`} aria-label={`Join ${e.title || 'Busy'}`} onClick={() => safeOpen(e.meet_link, 'calendar')}><Video size={16} aria-hidden />Join</button>}
      {big && calendarLink(e.html_link) && <button type="button" className="btn" onClick={() => safeOpen(e.html_link, 'calendar')}>Open in Calendar</button>}
    </>
  );
}

/** A press holds for 600 ms, so a double tap closes one task and never the next one too (R4U01). */
function useHold(onPress: () => void) {
  const [held, setHeld] = useState(false);
  const lock = useRef(false);
  const press = (fn: () => void) => () => {
    if (lock.current) return;
    lock.current = true;
    setHeld(true);
    onPress();
    fn();
    setTimeout(() => { lock.current = false; setHeld(false); }, 600);
  };
  return { held, press };
}

/** What every row needs to know about the day. */
type Ctx = { p: Plan; today: string; now: number; dayReady: boolean; claude: Set<string>; mixed: boolean; linked: boolean };

/** The marked line on the sheet: the one thing to do right now. */
function NowCard({ c, onPress }: { c: Ctx; onPress: () => void }) {
  const { p, today, now, dayReady, mixed } = c;
  const online = useOnline();
  const { openTask } = useTaskSheet();
  const { held, press } = useHold(onPress);
  const x = p.now as PlanItem;
  const tomorrow = istDate(istToMs(today) + 86_400_000);
  const title = planTitle(x);
  const facts = x.kind === 'task' ? nowFacts(x.task) : '';
  // Off the plan for the day reads "Not today". "Not now" is for a pick, which only moves to the end (R4Y16).
  const skip = (id: string, text: string, word = 'Not today') => (
    <button type="button" className="btn" aria-disabled={held} disabled={!online} data-testid="now-later" onClick={press(() => void skipToday(today, id, text))}>{word}</button>
  );
  const done = (fn: () => void) => <button type="button" className="btn primary" aria-disabled={held} disabled={!online} data-testid="now-done" onClick={press(fn)}>Done</button>;
  return (
    <section className="now-card" aria-labelledby="h-nowcard" data-testid="now-card" data-kind={x.kind}>
      <div className="nc-top">
        <h2 id="h-nowcard" className="nc-word" tabIndex={-1}>Now</h2>
        {x.kind === 'task' && mixed && <Area task={x.task} />}
      </div>
      <div key={`${x.kind}-${x.id}`} className="nc-swap">
        {x.kind === 'task'
          ? <button type="button" className="nc-title" data-testid="now-title" aria-label={`Open ${title}`} onClick={() => openTask(x.task.id)}>{title}</button>
          : <p className="nc-title" data-testid="now-title">{title}</p>}
        {facts && <p className="nc-facts"><Numbers text={facts} /></p>}
        <p className="nc-line" data-testid="now-line"><Numbers text={nowLine(p, now, istTime)} /></p>
      </div>
      <div className="nc-acts">
        {x.kind === 'task' && (
          <>
            {done(() => void (isFollowUp(x.task) ? followedUp(x.task, today) : completeTask(x.task)))}
            {!x.fixed && x.suggested && skip(x.id, `Not today: ${title}`)}
            {!x.fixed && !x.suggested && p.queue.length > 1 && (
              <button type="button" className="btn" aria-disabled={held} disabled={!online || !dayReady} data-testid="now-later" onClick={press(() => void reorderPlan(today, p.queue, x.id, 'last'))}>Not now</button>
            )}
            <span className="grow" />
            <TaskSide task={x.task} today={today} onOpen={openTask} actions={[{ label: 'Tomorrow', aria: `Move ${title} to tomorrow`, onClick: () => void moveTask(x.id, tomorrow, { pick: false }) }]} />
          </>
        )}
        {x.kind === 'habit' && (
          <>
            {done(() => void tickHabit(x.habit, today))}
            {skip(x.id, `Not today: ${title}`)}
          </>
        )}
        {x.kind === 'event' && (
          <>
            <EventLinks e={x.event} big />
            {x.running && <button type="button" className="btn" aria-disabled={held} disabled={!online} data-testid="now-finished" onClick={press(() => void skipToday(today, x.id, `Finished early: ${title}`))}>Finished early</button>}
          </>
        )}
        {x.kind === 'step' && (
          <>
            <Link to="/plan" className="btn primary" data-testid="now-plan">Plan tomorrow</Link>
            {skip(x.id, 'Not tonight: Plan tomorrow', 'Not now')}
          </>
        )}
      </div>
    </section>
  );
}

/** Now with nothing to do: free time, the end of the plan, or the end of the day. Still a marked line, in the same place. */
function NowBlank({ c, title, line, kind, more, add }: { c: Ctx; title: string; line: string | null; kind: string; more: boolean; add: boolean }) {
  const online = useOnline();
  const { toggle } = useAdd();
  return (
    <section className="now-card empty-now" aria-labelledby="h-nowcard" data-testid="now-card" data-kind={kind}>
      <div className="nc-top"><h2 id="h-nowcard" className="nc-word" tabIndex={-1}>Now</h2></div>
      <div className="nc-swap">
        <p className="nc-title" data-testid="now-title">{title}</p>
        {line && <p className="nc-line" data-testid="now-line"><Numbers text={line} /></p>}
      </div>
      {(more || add) && (
        <div className="nc-acts">
          {more && <button type="button" className="btn primary" disabled={!online} data-testid="one-more" onClick={() => void oneMore(c.today)}>One more</button>}
          {add && <button type="button" className="btn primary" aria-label="Add a task" data-testid="now-add" onClick={toggle}>Add</button>}
        </div>
      )}
    </section>
  );
}

/** A plan row: time, tick, what. A time with a tilde is an estimate. */
function PlanLine({ x, c, word }: { x: PlanRow; c: Ctx; word?: string }) {
  const { p, today, now, dayReady, claude, mixed, linked } = c;
  const online = useOnline();
  const { openTask } = useTaskSheet();
  const { openReminder } = useReminderSheet();
  const tomorrow = istDate(istToMs(today) + 86_400_000);
  const anyTime = x.kind === 'habit' && x.anyTime;
  const shown = anyTime
    ? <span className="wl-t wl-any">any time</span>
    : x.running
      ? <span className="wl-t wl-any">after</span>
      : x.fixed
        ? <span className="wl-t">{istTime(x.at)}</span>
        : <span className="wl-t"><span className="tilde" aria-hidden>~</span><span className="sr">about </span>{istTime(estimateAt(x.at))}</span>;
  const time = <span className={`wl-time mono ${x.fixed ? '' : 'est'}`}>{word && <span className="wl-word">{word}</span>}{shown}</span>;
  const cls = `wrow ${word ? 'next' : ''}`;
  if (x.kind === 'task') {
    const t = x.task;
    const canMove = !x.fixed && p.queue.includes(t.id);
    const acts: RowAction[] = [
      ...(canMove ? [{ label: 'Do first', aria: `Do ${t.title} first`, onClick: () => void reorderPlan(today, p.queue, t.id, 'first') }] : []),
      ...(x.suggested ? [{ label: 'Not today', aria: `Not today: ${t.title}`, onClick: () => void skipToday(today, t.id, `Not today: ${t.title}`) }] : []),
      { label: 'Tomorrow', aria: `Move ${t.title} to tomorrow`, onClick: () => void moveTask(t.id, tomorrow, { pick: false }) },
    ];
    const onGoogle = linked && !!t.due_date && !!t.due_time;
    return (
      <li className={`${cls} ${rowState(t, claude, now, false)}`} data-testid="plan-row" data-kind="task" data-task-id={t.id}>
        <TaskCheck task={t} />
        {time}
        <span className="wl-body">
          <button type="button" className="main-btn" aria-label={`Open ${t.title}`} onClick={() => openTask(t.id)}>
            <span className="t1 ell2">{t.title}</span>
            {(mixed || t.est_minutes || onGoogle) && (
              <span className="t3 wl-meta">
                {mixed && <Area task={t} />}
                {t.est_minutes ? <span className="mono">{spell(t.est_minutes)}</span> : null}
                {onGoogle && <span className="wl-on-google" data-testid="on-google"><CalendarDays size={13} aria-hidden /><span className="sr">On Google Calendar</span></span>}
              </span>
            )}
          </button>
        </span>
        <TaskSide task={t} today={today} onOpen={openTask} actions={dayReady ? acts : acts.slice(-1)} />
      </li>
    );
  }
  if (x.kind === 'habit') {
    return (
      <li className={cls} data-testid="plan-row" data-kind="habit">
        <Check checked={false} disabled={!online} label={`${x.habit.name} done today`} onChange={() => void tickHabit(x.habit, today)} />
        {time}
        <span className="wl-body"><span className="main-btn"><span className="t1 ell2">{x.habit.name}</span></span></span>
      </li>
    );
  }
  if (x.kind === 'step') {
    return (
      <li className={cls} data-testid="plan-row" data-kind="step">
        <span className="wl-glyph" aria-hidden><ClipboardCheck size={16} /></span>
        {time}
        <span className="wl-body"><Link to="/plan" className="main-btn plain"><span className="t1">{planTitle(x)}</span></Link></span>
      </li>
    );
  }
  if (x.kind === 'mark' && x.reminder) {
    const r = x.reminder;
    return (
      <li className={`${cls} quiet`} data-testid="plan-row" data-kind="reminder">
        <Check checked={false} disabled={!online} label={`${r.title} done`} onChange={() => void tickReminder(r)} />
        {time}
        <span className="wl-body"><button type="button" className="main-btn" onClick={() => openReminder(r.id)}><span className="t1 ell2">{r.title}</span><span className="sr">, reminder</span></button></span>
      </li>
    );
  }
  const e = x.event as CalendarEvent;
  return (
    <li className={`${cls} ${x.kind === 'mark' ? 'quiet' : ''}`} data-testid="plan-row" data-kind="event">
      <span className="wl-glyph" aria-hidden><CalendarDays size={16} /></span>
      {time}
      <span className="wl-body">
        {calendarLink(e.html_link)
          ? <button type="button" className="main-btn" aria-label={`Open ${e.title || 'Busy'} in Google Calendar`} onClick={() => safeOpen(e.html_link, 'calendar')}><span className="t1 ell2">{e.title || 'Busy'}</span></button>
          : <span className="main-btn"><span className="t1 ell2">{e.title || 'Busy'}</span></span>}
      </span>
      <span className="side"><EventLinks e={e} /></span>
    </li>
  );
}

/** One line that opens. Everything that is not the plan lives behind one of these. `text` replaces the count and label. */
function Fold({ id, count, label, hint, text, tail, children }: { id: string; count: number; label: string; hint: string; text?: string; tail?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!count) return null;
  return (
    <section className={`fold ${id}`} aria-label={label}>
      <button type="button" className="older-toggle" aria-expanded={open} onClick={() => setOpen(!open)} data-testid={`fold-${id}`}>
        {open ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
        {text ? <span>{text}</span> : tail ? <span>{label} <b className="mono">{count}</b></span> : <span><b className="mono">{count}</b> {label}</span>}
        <span className="sec-n" aria-hidden>{open ? 'hide' : hint}</span>
      </button>
      {open && children}
    </section>
  );
}

const HOUR_PX = 48;
/** The shortest block drawn, in px and as time: blocks that touch on screen need their own lanes too. */
const MIN_BLOCK_PX = 18;
const MIN_BLOCK_MS = (MIN_BLOCK_PX / HOUR_PX) * 3600_000;
type Block = { key: string; title: string; at: number; end: number; cls: string };

/**
 * The day at a glance on a wide screen: fixed blocks and Now only, side by side when they overlap, the teal line is now. The
 * list holds everything else (R4P29). Earlier blocks show only here, but a screen reader has them on Google, so it skips this.
 */
function DayLine({ p, now, today, blocks, past }: { p: Plan; now: number; today: string; blocks: Block[]; past: Block[] }) {
  const ref = useRef<HTMLElement>(null);
  const start = istToMs(today);
  const hours = (ms: number) => (ms - start) / 3600_000;
  const flex = p.now && !p.now.fixed ? [{ key: `now-${p.now.id}`, title: planTitle(p.now), at: p.now.at, end: p.now.end, cls: 'flex now' }] : [];
  const all = [...past, ...blocks, ...flex];
  const from = Math.max(0, Math.min(7, ...[...all.map((b) => b.at), now].map((ms) => Math.floor(hours(ms)))));
  const to = Math.min(24, Math.max(23, ...[...all.map((b) => b.end), now].map((ms) => Math.ceil(hours(ms)))));
  const bottom = (to - from) * HOUR_PX;
  const y = (ms: number) => Math.min(bottom, Math.max(0, (hours(ms) - from) * HOUR_PX));
  const size = (b: Block) => ({ top: y(b.at), height: Math.max(MIN_BLOCK_PX, y(b.end) - y(b.at) - 2) });
  const drawn = [...past, ...blocks].map((b) => ({ ...b, reach: Math.max(b.end, b.at + MIN_BLOCK_MS) }));
  const hourNow = istParts(now).hh;
  useEffect(() => {
    const el = ref.current;
    const grid = el?.querySelector<HTMLElement>('.dl-grid');
    if (el && grid) el.scrollTop = grid.offsetTop + y(now) - el.clientHeight / 3;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hourNow, today, from]);
  return (
    <aside className="dayline sheetpaper" aria-hidden tabIndex={-1} ref={ref} data-testid="dayline">
      <div className="dl-h">The day</div>
      <div className="dl-grid" style={{ height: bottom + 12 }}>
        {Array.from({ length: to - from + 1 }, (_, i) => from + i).map((h) => <span key={h} className="dl-hour mono" style={{ top: (h - from) * HOUR_PX }}>{String(h).padStart(2, '0')}</span>)}
        {flex.map((b) => <span key={b.key} className={`dl-block ${b.cls}`} style={size(b)}>{b.title}</span>)}
        {laneBlocks(drawn.map((b) => ({ ...b, end: b.reach }))).map((b, i) => {
          const real = drawn.find((x) => x.key === b.key) ?? drawn[i];
          return <span key={b.key} className={`dl-block ${b.cls}`} style={{ ...size(real), left: `${(b.lane / b.lanes) * 100}%`, width: `${100 / b.lanes}%` }}>{b.title}</span>;
        })}
        <span className="dl-now" style={{ top: y(now) }} />
      </div>
    </aside>
  );
}

/** First view: Now, Next and three rows; the rest of the day folds into one line (call L). */
const FIRST_ROWS = 3;

/**
 * The war room (logs/qa-r4-plan.md decision 9). One screen for the whole day, work and personal: the thing to do now, the
 * thing after it, then the rest in order. Google Calendar's fixed blocks sit in the same order. Everything else is one line.
 */
export function WarRoom() {
  const d = useDay();
  const { today, now, open, doneToday, doneHabits, doneReminders, doneCount, sheet, asks, askFor, pickOrder, planSkip, flagsSeen, failed, opening, retry, tomorrowFirst, todayFirst, tomorrowPicked, dayRow, slices } = d;
  const loc = useLocation();
  const online = useOnline();
  const { openTask } = useTaskSheet();
  const calendar = useSlice('calendar');
  const calState = useSlice('calendar_state');
  const days = d.days;
  const dayReady = online && days.status === 'ready' && !days.stale;
  const wide = useIsPhone('(min-width: 1180px)');
  const [, tick] = useReducer((n: number) => n + 1, 0);
  // The plan is built from the clock, so it moves on by itself while the screen is open.
  useEffect(() => { const id = setInterval(tick, 30_000); return () => clearInterval(id); }, []);

  const keep = useRef<string | null>(null);
  const plan = useMemo(
    () => buildPlan({ sheet, nowMs: now, today, events: calendar.rows, open, order: pickOrder, skip: planSkip, tomorrowPicked, keep: keep.current }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sheet, now, today, calendar.rows, open, pickOrder.join(), planSkip, tomorrowPicked],
  );
  const nowKey = plan.now ? `${plan.now.kind}-${plan.now.id}` : 'none';
  useEffect(() => { keep.current = plan.now?.kind === 'task' ? plan.now.id : null; }, [plan.now]);

  // When a press takes its own button away, focus comes to Now instead of falling to the page (R4U05).
  const pressed = useRef(false);
  useEffect(() => {
    if (!pressed.current) return;
    pressed.current = false;
    if (document.activeElement === document.body) document.getElementById('h-nowcard')?.focus({ preventScroll: true });
  }, [nowKey]);

  if (loc.search.includes('plan=1')) return <Navigate to="/plan" replace />;

  const hh = istParts(now).hh;
  const evening = isEvening(hh);
  const smallHours = hh < 5;
  const calReady = calState.status === 'ready' || calState.status === 'error';
  const calLine = calReady ? calendarLine(calState.rows[0], now, istTime) : null;
  const linked = calState.rows[0]?.linked ?? false;
  const older = sheet.older.filter((r) => !plan.queue.includes(r.task.id));
  const tasksShown = [plan.now, ...plan.rows].flatMap((r) => (r?.kind === 'task' ? [r.task] : []));
  const mixed = new Set([...tasksShown, ...plan.spare.map((x) => x.task), ...older.map((r) => r.task)].map((t) => t.area)).size > 1;
  const c: Ctx = { p: plan, today, now, dayReady, claude: d.withClaude, mixed, linked };

  const nextAt = plan.next ? plan.rows.indexOf(plan.next) : -1;
  const cut = nextAt + 1 + FIRST_ROWS;
  // One row left over is not worth a fold.
  const firstRows = plan.rows.length - cut <= 1 ? plan.rows : plan.rows.slice(0, cut);
  const restRows = plan.rows.slice(firstRows.length);
  const line = (x: PlanRow) => <PlanLine key={`${x.kind}-${x.id}`} x={x} c={c} word={x === plan.next ? 'Next' : undefined} />;

  const closing = closingLine(smallHours ? todayFirst : tomorrowFirst);
  const blank = plan.night
    ? { kind: 'night', title: 'Day is done.', line: closing }
    : plan.finished
      ? { kind: 'finished', title: 'That was the plan.', line: plan.freeUntil ? freeLine(plan.freeUntil, istTime) : null }
      : plan.freeUntil
        ? { kind: 'free', title: freeLine(plan.freeUntil, istTime), line: null }
        : doneCount
          ? { kind: 'none', title: 'All done.', line: tomorrowPicked > 0 ? closing : null }
          : { kind: 'none', title: evening ? 'Nothing else today.' : open.length ? 'Nothing is planned yet.' : 'Add the first thing to do.', line: null };
  const liveTitle = plan.now ? planTitle(plan.now) : blank.title;
  const lookWord = sheet.now.length === 1 ? 'thing needs a look' : 'things need a look';

  const page = (
    <div className="sheetpaper war-paper" data-testid="day-sheet">
      <header className="sheet-head war-head">
        <div>
          <h1 className="date" data-testid="today-date">{longDate(today)}</h1>
          <p className="greet" data-testid="greeting">{greeting(now)}. {failed ? 'Your day did not load.' : opening ? 'Opening your day.' : headLine(plan, doneCount)}</p>
        </div>
        <Stamp name={sheetName(hh)} />
      </header>
      <p className="sr" aria-live="polite" data-testid="now-live">{opening ? '' : `Now: ${liveTitle}`}</p>
      {opening && <div className="now-card ph-now" aria-hidden data-testid="now-loading" />}
      <ListState slices={slices} empty={false} emptyText="" onRetry={retry}>
        {calLine && <p className="war-note" data-testid="calendar-line">{calLine === NOT_LINKED_LINE ? <Link to="/settings">{calLine}</Link> : calLine}</p>}
        {plan.allDay.length > 0 && <p className="war-allday" data-testid="all-day">{plan.allDay.map((e) => e.title || 'Busy').join(' · ')}</p>}
        <Fold id="look" count={sheet.now.length} label={lookWord} hint="show">
          <ul className="list" data-testid="sec-now">
            {sheet.now.map((r, i) => (r.kind === 'flag'
              ? <FlagRow key={r.id} r={r} showWord={i === 0} seen={flagsSeen} today={today} />
              : <AlertRow key={r.event.id} r={r} showWord={i === 0} now={now} />))}
          </ul>
        </Fold>
        {hh >= 5 && hh < 12 && dayRow?.plan?.trim() && <p className="war-day" data-testid="day-line">{dayRow.plan}</p>}
        {plan.now
          ? <NowCard c={c} onPress={() => { pressed.current = true; }} />
          : <NowBlank c={c} title={blank.title} line={blank.line} kind={blank.kind} more={(plan.finished || blank.kind === 'free') && plan.canMore} add={blank.kind === 'none' && !doneCount && !open.length && !evening} />}
        {plan.started && plan.now?.kind === 'task' && plan.now.suggested && !(evening && tomorrowPicked > 0) && <p className="war-note" data-testid="start-line">Nothing picked, so here is a start.</p>}
        {plan.rows.length > 0 && <h2 className="sr">The rest of today</h2>}
        {firstRows.length > 0 && <ul className="list war-list" data-testid="plan-list" aria-label="The rest of today, in order">{firstRows.map(line)}</ul>}
        <div className="folds">
          <h2 className="sr">Also today</h2>
          <Fold id="rest" count={restRows.length} label="Rest of today" hint="show" tail>
            <ul className="list war-list" data-testid="sec-rest">{restRows.map(line)}</ul>
          </Fold>
          <Fold id="ticks" count={plan.passed.length} label={plan.passed.length === 1 ? 'habit to tick' : 'habits to tick'} hint="tick any">
            <ul className="list war-list" data-testid="sec-ticks">
              {plan.passed.map((h) => (
                <li key={h.id} className="wrow quiet passed" data-testid="plan-row" data-kind="habit">
                  <Check checked={false} disabled={!online} label={`${h.name} done today`} onChange={() => void tickHabit(h, today)} />
                  <span className="wl-body"><span className="main-btn"><span className="t1 ell2">{h.name}</span></span></span>
                </li>
              ))}
            </ul>
          </Fold>
          <Fold id="claude" count={asks.length} label="with Claude" hint="show">
            <ul className="list" data-testid="sec-claude">
              {asks.map((r) => {
                const t = r.task_id && askFor.get(r.task_id) === r ? open.find((x) => x.id === r.task_id) : undefined;
                return (
                  <li key={r.id} className="wrow plain" data-testid="claude-row" data-status={r.status}>
                    <span className="wl-body">
                      {t ? <TaskText task={t} today={today} now={now} onOpen={openTask} sheet /> : <span className="main-btn"><span className="t1 ell2">{r.title}</span></span>}
                      <ClaudeLine req={r} now={now} task={t} />
                    </span>
                  </li>
                );
              })}
            </ul>
          </Fold>
          <Fold id="spare" count={plan.spare.length} label="more if there is time" hint="show" text={spareText(plan) ?? undefined}>
            <ul className="list war-list" data-testid="sec-spare">{plan.spare.map(line)}</ul>
          </Fold>
          <Fold id="older" count={plan.night ? 0 : older.length} label={older.length === 1 ? 'older task' : 'older tasks'} hint="pick any for today">
            <ul className="list war-list" data-testid="sec-older">
              {older.map((r) => {
                const t = r.task;
                return (
                  <li key={t.id} className={`wrow ${rowState(t, d.withClaude, now, false)}`} data-testid="plan-row" data-task-id={t.id}>
                    <TaskCheck task={t} />
                    <span className="wl-time mono est"><span className="wl-t">{r.spine?.text}</span></span>
                    <span className="wl-body">
                      <button type="button" className="main-btn" aria-label={`Open ${t.title}`} onClick={() => openTask(t.id)}>
                        <span className="t1 ell2">{t.title}</span>
                        {mixed && <span className="t3 wl-meta"><Area task={t} /></span>}
                      </button>
                    </span>
                    <TaskSide task={t} today={today} onOpen={openTask} actions={[{ label: 'Today', aria: `Plan ${t.title} for today`, inline: true, onClick: () => void moveTask(t.id, today) }]} />
                  </li>
                );
              })}
            </ul>
          </Fold>
          <Fold id="done" count={doneCount} label="done today" hint="show">
            <ul className="list war-list" data-testid="sec-done">
              {doneToday.map((t) => (
                <li key={t.id} className="wrow done" data-testid="plan-row" data-task-id={t.id}>
                  <Check checked disabled={!online} label={`Reopen ${t.title}`} onChange={() => void setTaskDone(t.id, false)} />
                  <span className="wl-body"><TaskText task={t} today={today} now={now} onOpen={openTask} sheet /></span>
                </li>
              ))}
              {doneHabits.map((r) => (
                <li key={r.habit.id} className="wrow done" data-testid="plan-row" data-kind="habit">
                  <Check checked disabled={!online} label={`Reopen ${r.habit.name}`} onChange={() => void toggleHabitDay(r.habit.id, today, false)} />
                  <span className="wl-body"><span className="main-btn"><span className="t1 ell2">{r.habit.name}</span></span></span>
                </li>
              ))}
              {doneReminders.map((r) => (
                <li key={r.reminder.id} className="wrow done" data-testid="plan-row" data-kind="reminder">
                  <Check checked disabled={!online} label={`Reopen ${r.reminder.title}`} onChange={() => void reminderDone(r.reminder, false)} />
                  <span className="wl-body"><span className="main-btn"><span className="t1 ell2">{r.reminder.title}</span></span></span>
                </li>
              ))}
            </ul>
          </Fold>
        </div>
        <footer className="war-foot">
          {tomorrowPicked > 0 && !plan.night && (plan.now || !doneCount) && <p className="war-tm" data-testid="tomorrow-line">{closing}</p>}
          <Link to="/plan" className={`btn ${evening && !plan.now ? 'primary' : ''}`} data-testid="plan-link">{evening ? 'Close today and plan tomorrow' : 'Plan tomorrow'}</Link>
        </footer>
      </ListState>
    </div>
  );
  const past: Block[] = plan.earlier.map((e) => ({ key: `past-${e.id}`, title: e.title || 'Busy', at: new Date(e.starts_at as string).getTime(), end: new Date(e.ends_at as string).getTime(), cls: 'past' }));
  const blocks: Block[] = [plan.now, ...plan.rows].flatMap((r): Block[] => (
    r && r.kind !== 'mark' && r.fixed ? [{ key: `${r.kind}-${r.id}`, title: planTitle(r), at: r.at, end: r.end, cls: r === plan.now ? 'now' : '' }] : []
  ));
  if (!wide || (!blocks.length && !past.length && !plan.now)) return page;
  return <div className="war-grid">{page}<DayLine p={plan} now={now} today={today} blocks={blocks} past={past} /></div>;
}
