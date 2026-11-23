import { useEffect, useMemo, useRef, useState } from 'react';
import { Check as CheckIcon, Plus } from 'lucide-react';
import { ListState } from './ui';
import { TaskRow } from './TaskRow';
import { useTaskSheet } from './TaskSheet';
import { movePickUp, planTask, saveDay } from '../lib/actions';
import { formatDue } from '../lib/logic/format';
import { eventsOn } from '../lib/logic/plan';
import { byPickOrder, groupTasks, matchesSearch, sumMinutes } from '../lib/logic/tasks';
import { capturedToday, claudeOnToday, closingLine, suggestPicks } from '../lib/logic/today';
import { useOnline } from '../lib/online';
import { store, useSlice } from '../lib/store';
import type { Task } from '../lib/types';
import { addDays, istTime, istToMs } from '../shared/ist';

/** Day text may only be written once the day rows are loaded and fresh, so a save never blanks a row it has not seen (D5). */
export function useDayReady(): boolean {
  const days = useSlice('days');
  const online = useOnline();
  return online && days.status === 'ready' && !days.stale;
}

/** Text for one day. Unsaved text saves to the day it was typed for, even after midnight (PL-09). */
function DayText({ day, field, label, placeholder, line }: { day: string; field: 'plan' | 'review'; label: string; placeholder?: string; line?: boolean }) {
  const days = useSlice('days');
  const ready = useDayReady();
  const saved = days.rows.find((d) => d.day === day)?.[field] ?? '';
  const [v, setV] = useState(saved);
  const dirty = useRef(false);
  const latest = useRef(v);
  latest.current = v;
  useEffect(() => () => {
    if (dirty.current) { dirty.current = false; void saveDay(day, { [field]: latest.current.trim() === '' ? null : latest.current }); }
  }, [day, field]);
  useEffect(() => { if (!dirty.current) setV(saved); }, [saved, day]);
  const common = {
    value: v, disabled: !ready, placeholder, 'aria-label': label,
    onChange: (e: { target: { value: string } }) => { dirty.current = true; setV(e.target.value); },
    onBlur: () => { if (dirty.current) { dirty.current = false; void saveDay(day, { [field]: v.trim() === '' ? null : v }); } },
  };
  return (
    <label className="ruled-field">
      <span className="lbl">{label}</span>
      {line ? <input className="plan-line" {...common} /> : <textarea className="review-line" rows={2} {...common} />}
    </label>
  );
}

/** One tap picks or unpicks a task for tomorrow. The planner covers both areas, so every row carries its tag (F07). */
function PickRow({ t, on, onToggle, today }: { t: Task; on: boolean; onToggle: () => void; today: string }) {
  const online = useOnline();
  return (
    <li className={`row pick ${on ? 'on' : ''}`} data-testid="task-row" data-task-id={t.id}>
      <button type="button" className="main-btn" aria-pressed={on} disabled={!online} aria-label={`Tomorrow toggle for ${t.title}`} onClick={onToggle}>
        <span className="t1 ell2">{t.title}</span>
        <span className="t3">
          <span className={`area-tag ${t.area}`}>{t.area}</span>
          {[capturedToday(t, today) ? 'captured today' : t.due_date ? formatDue(t.due_date, today).text : '', t.est_minutes ? `${t.est_minutes} min` : ''].filter(Boolean).join(' · ')}
        </span>
      </button>
      <span className="pick-mark" aria-hidden>{on ? <CheckIcon size={16} strokeWidth={3} /> : <Plus size={16} />}</span>
    </li>
  );
}

/** The evening half of the sheet: the picks, suggested picks, the full list on demand, then tomorrow's line, review and mood. */
export function Tomorrow({ today }: { today: string }) {
  const tomorrow = addDays(today, 1);
  const ready = useDayReady();
  const { openTask } = useTaskSheet();
  const tasks = useSlice('tasks');
  const days = useSlice('days');
  const claude = useSlice('claude');
  const now = Date.now();
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState('');
  const open = useMemo(() => tasks.rows.filter((t) => t.status === 'open'), [tasks.rows]);
  const held = useMemo(() => new Set(claude.rows.filter(claudeOnToday).flatMap((r) => (r.task_id ? [r.task_id] : []))), [claude.rows]);
  const suggested = useMemo(() => suggestPicks(open, today, 5, held), [open, today, held]);
  const groups = useMemo(() => groupTasks(open.filter((t) => matchesSearch(t, q)), today, false), [open, today, q]);
  const order = days.rows.find((d) => d.day === tomorrow)?.top_task_ids ?? [];
  const picked = useMemo(() => byPickOrder(open.filter((t) => t.planned_for === tomorrow), order), [open, tomorrow, order]);
  const mood = days.rows.find((d) => d.day === today)?.mood ?? null;
  const calendar = useSlice('calendar');
  const fixed = useMemo(() => eventsOn(calendar.rows, tomorrow), [calendar.rows, tomorrow]);
  const toggle = (t: Task) => void planTask(t.id, t.planned_for === tomorrow ? null : tomorrow);

  return (
    <div data-testid="tomorrow">
      {(fixed.timed.length > 0 || fixed.allDay.length > 0) && (
        <>
          <h3 className="sub-h">Already on your calendar</h3>
          <ul className="cal-list" data-testid="tomorrow-calendar">
            {fixed.allDay.map((e) => <li key={e.id}><span className="mono">all day</span><span>{e.title || 'Busy'}</span></li>)}
            {fixed.timed.map((e) => {
              const at = new Date(e.starts_at as string).getTime();
              return <li key={e.id}><span className="mono">{at < istToMs(tomorrow) ? 'all day' : istTime(at)}</span><span>{e.title || 'Busy'}</span></li>;
            })}
          </ul>
        </>
      )}
      <div className="block-h sub-row">
        <h3 className="sub-h">Picked for tomorrow</h3>
        <span className="sec mono" data-testid="pick-footer">{picked.length} picked, {sumMinutes(picked)} min</span>
      </div>
      {picked.length === 0 ? <p className="empty">Nothing picked yet. Tap a task below or in the full list.</p> : (
        <ul className="list" data-testid="picked-list">
          {picked.map((t, i) => (
            <TaskRow
              key={t.id} task={t} today={today} now={now} onOpen={openTask}
              actions={[
                { label: 'Unpick', aria: `Unpick ${t.title}`, inline: true, chip: true, onClick: () => toggle(t) },
                ...(i > 0 ? [{ label: 'Move up', aria: `Move ${t.title} up`, onClick: () => void movePickUp(tomorrow, picked.map((p) => p.id), t.id) }] : []),
              ]}
            />
          ))}
        </ul>
      )}
      {suggested.length > 0 && (
        <>
          <h3 className="sub-h">Suggested for tomorrow</h3>
          <ul className="list" data-testid="suggest-list">
            {suggested.map((t) => <PickRow key={t.id} t={t} on={false} onToggle={() => toggle(t)} today={today} />)}
          </ul>
        </>
      )}
      <div className="pick-more-row">
        <button type="button" className="btn ghost" aria-expanded={picking} onClick={() => setPicking(!picking)} data-testid="pick-more">{picking ? 'Hide the list' : 'Show all tasks'}</button>
      </div>
      {picking && (
        <ListState slices={[tasks]} empty={open.length === 0} emptyText="No open tasks." onRetry={() => void store.refresh(['tasks'])}>
          <input className="input" type="search" aria-label="Search all tasks" placeholder="Search all tasks" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="pick-list">
            {groups.length === 0 && <p className="empty">No task matches.</p>}
            {groups.map((g) => (
              <section key={g.key} aria-label={g.label} data-testid={`group-${g.key}`}>
                <div className="group-h"><h3>{g.label}</h3><span className="sec mono">{g.tasks.length}</span></div>
                <ul className="list">{g.tasks.map((t) => <PickRow key={t.id} t={t} on={t.planned_for === tomorrow} onToggle={() => toggle(t)} today={today} />)}</ul>
              </section>
            ))}
          </div>
        </ListState>
      )}
      <DayText day={tomorrow} field="plan" label="What is tomorrow about" placeholder="One line for tomorrow" line />
      <div className="two-col eve-close">
        <DayText day={today} field="review" label="How did today go" placeholder="Two lines, honest" />
        <div className="ruled-field">
          <span className="lbl" id="mood-l">Mood</span>
          <div className="mood" role="group" aria-labelledby="mood-l">
            {[1, 2, 3, 4, 5].map((m) => (
              <button key={m} type="button" className="chip" aria-pressed={mood === m} disabled={!ready} aria-label={`Mood ${m}`} onClick={() => void saveDay(today, { mood: mood === m ? null : m })}>{m}</button>
            ))}
          </div>
          <div className="mood-scale" aria-hidden><span>rough</span><span>great</span></div>
        </div>
      </div>
      <p className="closing-line" data-testid="closing-line">{closingLine(picked[0]?.title ?? null)}</p>
    </div>
  );
}
