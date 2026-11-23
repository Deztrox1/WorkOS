import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Stamp } from '../components/Stamp';
import { AlertRow, ClaudeLine, FlagRow, Row } from '../components/SheetRows';
import { Check, ListState } from '../components/ui';
import { rowState, TaskCheck, TaskSide, TaskText, useIsPhone } from '../components/TaskRow';
import { useTaskSheet } from '../components/TaskSheet';
import { Tomorrow } from '../components/Tomorrow';
import { dropTask, moveTask, setTaskDone, tickHabit, toggleHabitDay } from '../lib/actions';
import { longDate } from '../lib/logic/format';
import { claudeState, closeRows, closingLine, eveningLine, isEvening, type SheetRow, type SheetTask } from '../lib/logic/today';
import { useOnline } from '../lib/online';
import { useDay } from '../lib/useDay';
import { inFlight, type ClaudeRequest } from '../lib/types';
import { istParts } from '../shared/ist';

/**
 * Close the day and plan the next one, at any hour (logs/qa-r4-plan.md decision 9). Both areas: tick what you did, move the
 * rest, pick tomorrow. The war room links here. Order (QA r2 decision 8): what needs a look, With Claude, Close today, Tomorrow,
 * then Tomorrow's closing line. The day ends on its own sentence, never on an alarm.
 */
export function Plan() {
  // Before 05:00 the day just ended is still the one being closed, so a late pick lands on the coming morning (R4Y06).
  const d = useDay(true);
  const { today, tomorrow, now, open, sheet, asks, askFor, withClaude, dayRow, flagsSeen, failed, opening, retry, tomorrowFirst, slices } = d;
  const online = useOnline();
  const { openTask } = useTaskSheet();
  const split = useIsPhone('(min-width: 1200px)');
  const [habitsOpen, setHabitsOpen] = useState(false);
  const plan = dayRow?.plan ?? '';
  // Before 18:00 the day is still running, so this is only about tomorrow (R4P25). The small hours still close the day before.
  const hh = istParts(now).hh;
  const evening = isEvening(hh) || hh < 5;

  const onSheet = useMemo(() => new Set([...sheet.today, ...sheet.plan].flatMap((r) => (r.kind === 'task' ? [r.task.id] : []))), [sheet]);
  const loose = asks.filter((r) => !r.task_id || !onSheet.has(r.task_id) || askFor.get(r.task_id) !== r);
  const looseTask = (r: ClaudeRequest) => (r.task_id && askFor.get(r.task_id) === r ? open.find((t) => t.id === r.task_id) : undefined);

  const taskRow = (r: SheetTask, showWord: boolean) => {
    const t = r.task;
    const ask = askFor.get(t.id);
    if (r.done) {
      return (
        <Row key={`t-${t.id}`} band={r.band} showWord={showWord} spine={r.spine} cls="done" data={{ kind: 'task', 'task-id': t.id, done: true }}>
          <Check checked disabled={!online} label={`Reopen ${t.title}`} onChange={() => void setTaskDone(t.id, false)} />
          <span className="stack"><TaskText task={t} today={today} now={now} onOpen={openTask} sheet /></span>
        </Row>
      );
    }
    return (
      <Row
        key={`t-${t.id}`} band={r.band} showWord={showWord} spine={r.spine} data={{ kind: 'task', 'task-id': t.id }}
        cls={rowState(t, withClaude, now, false)}
        side={<TaskSide task={t} today={today} onOpen={openTask} actions={[]} />}
      >
        <TaskCheck task={t} stay />
        <span className="stack">
          <TaskText task={t} today={today} now={now} onOpen={openTask} sheet />
          {ask && onSheet.has(t.id) && <ClaudeLine req={ask} now={now} task={t} />}
          <span className="close-acts" role="group" aria-label={`Close ${t.title}`}>
            <button type="button" className="chip" disabled={!online} aria-label={`Move ${t.title} to tomorrow`} onClick={() => void moveTask(t.id, tomorrow, { pick: false })}>Tomorrow</button>
            <button type="button" className="chip" disabled={!online} aria-label={`Drop ${t.title}`} onClick={() => void dropTask(t.id)}>Drop</button>
          </span>
        </span>
      </Row>
    );
  };
  const habitRow = (r: SheetRow, showWord: boolean) => {
    if (r.kind !== 'habit') return null;
    const h = r.habit;
    return (
      <Row key={`h-${h.id}`} band="today" showWord={showWord} spine={r.spine} testid="habit-row" data={{ kind: 'habit', done: r.done }}>
        <Check checked={r.done} disabled={!online} label={`${h.name} done today`} onChange={(v) => void (v ? tickHabit(h, today) : toggleHabitDay(h.id, today, false))} />
        <span className="main-btn"><span className="t1">{h.name}</span></span>
      </Row>
    );
  };

  const head = (
    <>
      <header className="sheet-head">
        <div>
          <h1 className="date" data-testid="today-date">{longDate(today)}</h1>
          <p className="greet" data-testid="greeting">{failed ? 'Your day did not load.' : opening ? 'Opening your day.' : evening ? eveningLine(sheet, tomorrowFirst) : tomorrowFirst ? closingLine(tomorrowFirst) : 'Pick what tomorrow starts with.'}</p>
        </div>
        <Stamp name={evening ? 'Close today' : 'Plan tomorrow'} />
      </header>
      {plan.trim() && <p className="situation-ro" data-testid="situation-ro">{plan}</p>}
    </>
  );

  // Only tasks, open and done. Habits are one quiet line below, reminders have had their moment (QA r2 P15).
  const dayRows = closeRows(sheet);
  // A habit still to come is not left over: only what has had its time, or has none (R4Y07).
  const habitsLeft = sheet.today.filter((r) => r.kind === 'habit' && !r.done && (r.at === null || r.at <= now));
  const daySec = (
    <section className="sheet-sec" aria-labelledby="h-today">
      <div className="sec-h today"><h2 id="h-today">Close today</h2><span className="sec-n">tick what you did, move the rest</span></div>
      {dayRows.length === 0
        ? <p className="empty" data-testid="today-empty">Nothing picked for today.</p>
        : <ul className="list" data-testid="sec-today">{dayRows.map((r, i) => taskRow(r, i === 0 || dayRows[i - 1].band !== r.band))}</ul>}
      {evening && habitsLeft.length > 0 && (
        <div className="habit-quiet">
          <button type="button" className="older-toggle" aria-expanded={habitsOpen} onClick={() => setHabitsOpen(!habitsOpen)} data-testid="habits-left">
            {habitsOpen ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
            <span><b className="mono">{habitsLeft.length}</b> habit{habitsLeft.length === 1 ? '' : 's'} to tick</span>
            <span className="sec-n">{habitsOpen ? 'hide' : 'tick one'}</span>
          </button>
          {habitsOpen && <ul className="list" data-testid="sec-habits">{habitsLeft.map((r, i) => habitRow(r, i === 0))}</ul>}
        </div>
      )}
    </section>
  );
  const nowSec = sheet.now.length > 0 && (
    <section className="sheet-sec" aria-labelledby="h-now">
      <div className="sec-h now"><h2 id="h-now">Needs a look</h2></div>
      <ul className="list" data-testid="sec-now">
        {sheet.now.map((r, i) => (r.kind === 'flag'
          ? <FlagRow key={r.id} r={r} showWord={i === 0} seen={flagsSeen} today={today} />
          : <AlertRow key={r.event.id} r={r} showWord={i === 0} now={now} />))}
      </ul>
    </section>
  );
  const claudeSec = loose.length > 0 && (
    <section className="sheet-sec" aria-labelledby="h-claude">
      <div className="sec-h"><h2 id="h-claude">With Claude</h2><Link to="/claude" className="sec-n tap">all requests</Link></div>
      <ul className="list" data-testid="sec-claude">
        {loose.map((r, i) => {
          const t = looseTask(r);
          return (
            <Row key={`c-${r.id}`} band="claude" showWord={i === 0} spine={null} testid="claude-row" data={{ status: r.status, state: claudeState(r, now) }} cls={inFlight(r.status) ? 'claude-wait' : ''}
              side={t ? <TaskSide task={t} today={today} onOpen={openTask} /> : undefined}
            >
              {t ? <TaskCheck task={t} stay /> : <span className="check" aria-hidden />}
              <span className="stack">
                {t ? <TaskText task={t} today={today} now={now} onOpen={openTask} sheet /> : <span className="main-btn"><span className="t1 ell2">{r.title}</span></span>}
                <ClaudeLine req={r} now={now} task={t} />
              </span>
            </Row>
          );
        })}
      </ul>
    </section>
  );
  const tomorrowBlock = (
    <section className={`tomorrow ${split ? 'sheetpaper' : 'sheet-sec'}`} data-open aria-labelledby="h-tm">
      <div className="sec-h tm-h"><h2 id="h-tm">{`Tomorrow, ${longDate(tomorrow)}. ${open.filter((t) => t.planned_for === tomorrow).length} picked`}</h2></div>
      <Tomorrow today={today} />
    </section>
  );
  const body = (
    <ListState slices={slices} empty={false} emptyText="" onRetry={retry}>
      {nowSec}
      {claudeSec}
      {daySec}
      {!split && tomorrowBlock}
    </ListState>
  );

  if (split) {
    return (
      <div className="sheet-grid evening">
        <div className="day-col"><div className="sheetpaper" data-testid="day-sheet">{head}{body}</div></div>
        <aside className="eve-col" aria-label="Evening">{tomorrowBlock}</aside>
      </div>
    );
  }
  return <div className="sheetpaper today-paper" data-testid="day-sheet">{head}{body}</div>;
}
