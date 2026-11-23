import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { CornerUpRight, MoreVertical } from 'lucide-react';
import { idleDays, isFollowUp, taskLine2, taskLine3 } from '../lib/logic/tasks';
import { store, useSlice } from '../lib/store';
import { completeTask, followedUp, moveTask, setTaskDone } from '../lib/actions';
import { useToday } from '../lib/clock';
import { useOnline } from '../lib/online';
import { inFlight, type Task } from '../lib/types';
import { addDays } from '../shared/ist';
import { useClaudeSheet } from './ClaudeSheet';
import { Check } from './ui';

/**
 * An extra row action (Tomorrow, Unpick, Drop, ...). It goes in the row menu, unless `inline` puts it on the row
 * itself on every screen size (the evening close and the picker, where one tap is the point).
 */
export type RowAction = { label: string; aria: string; onClick: () => void; pressed?: boolean; chip?: boolean; inline?: boolean };

const PHONE_QUERY = '(max-width: 767px)';

export function useIsPhone(query = PHONE_QUERY): boolean {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return phone;
}

type MenuItem = { label: string; aria?: string; run: () => void; disabled?: boolean; icon?: ReactNode };

/** The row menu: focus moves into it on open, arrows move, Escape closes and returns focus to the button. */
export function ActionMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    const away = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const arrows = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const els = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    els[(i + (e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length]?.focus();
  };
  return (
    <span className="row-menu" ref={ref} onBlur={(e) => { if (open && e.relatedTarget && !ref.current?.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <button ref={btn} type="button" className="icon-btn" aria-label={`Actions for ${label}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <MoreVertical size={18} aria-hidden />
      </button>
      {open && (
        <div className="menu" role="menu" aria-label={`Actions for ${label}`} onKeyDown={arrows}>
          {items.map((i) => (
            <button key={i.label} type="button" role="menuitem" className="menu-item" aria-label={i.aria} disabled={i.disabled} onClick={() => { setOpen(false); btn.current?.focus(); i.run(); }}>{i.icon}{i.label}</button>
          ))}
        </div>
      )}
    </span>
  );
}

/** Ids of tasks Claude still owes an answer on (queued, firing or working). */
export function useClaudeTaskIds(): Set<string> {
  const claude = useSlice('claude');
  return new Set(claude.rows.filter((r) => r.task_id && inFlight(r.status)).map((r) => r.task_id as string));
}
/**
 * Row state by line form: a dashed rule while Claude works on it, half-tone ink when idle 14 days or more.
 * Half-tone is for the Tasks list only; the sheet never greys a row it asks the owner to act on (F20).
 */
export function rowState(task: Task, withClaude: Set<string>, now: number, stale = true): string {
  const out: string[] = [];
  if (withClaude.has(task.id)) out.push('claude-wait');
  if (stale && task.status === 'open' && (idleDays(task, now) ?? 0) >= 14) out.push('stale');
  return out.join(' ');
}

/**
 * The text block of a task row, shared by the list row and the sheet row. On the sheet (`sheet`) the due text leaves
 * line 3 when it is overdue or today: the spine carries the age, and a planned task never reads "late".
 */
export function TaskText({ task, today, onOpen, sheet = false }: { task: Task; today: string; now?: number; onOpen: (id: string) => void; sheet?: boolean }) {
  const l2 = taskLine2(task);
  const l3 = taskLine3(task, today);
  const hideDue = sheet && !!task.due_date && task.due_date <= today;
  const rest = l3.text.slice(l3.due.length).replace(/^ · /, '');
  return (
    <button type="button" className="main-btn" onClick={() => onOpen(task.id)} aria-label={`Open ${task.title}`}>
      <span className="t1 ell2">{task.title}</span>
      {l2 && <span className="t2 ell1">{l2}</span>}
      {hideDue ? (rest && <span className="t3">{rest}</span>) : l3.text && (
        <span className="t3">
          {l3.text}
        </span>
      )}
    </button>
  );
}

/** A ticked row holds its tick and strike this long, then fades and folds away (QA r2 U05). Reduced motion: strike, then gone. */
const HOLD_MS = 800;
const HOLD_REDUCED_MS = 400;

/**
 * The tick on an open task. On a follow-up it is "Followed up", which logs the date (F12). Both give Done. Undo.
 * In a list the row leaves (`stay` off): the tick and strike show for 600 ms, then the row fades and folds while the task is
 * saved, and the row cannot be tapped meanwhile, so the next row never slides under a thumb. On the sheet (`stay`) the row
 * is done in place at once (QA r2 P08).
 */
export function TaskCheck({ task, stay = false }: { task: Task; stay?: boolean }) {
  const online = useOnline();
  const today = useToday();
  const [leaving, setLeaving] = useState(false);
  const follow = isFollowUp(task);
  const run = () => void (follow ? followedUp(task, today) : completeTask(task));
  const tick = () => {
    if (stay) { run(); return; }
    if (leaving) return;
    setLeaving(true);
    const calm = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const rows = [...document.querySelectorAll(`li[data-task-id="${task.id}"]`)];
    rows.forEach((li) => li.classList.add('leaving', ...(calm ? ['calm'] : [])));
    window.setTimeout(() => {
      // Still open? Then save it. The timer outlives this component, because the saved task unmounts the row.
      if (store.get('tasks').rows.find((t) => t.id === task.id)?.status === 'open') run();
      else rows.forEach((li) => li.classList.remove('leaving', 'calm'));
    }, calm ? HOLD_REDUCED_MS : HOLD_MS);
  };
  return (
    <Check
      checked={leaving} disabled={!online || leaving} label={follow ? `Followed up ${task.title}` : `Mark ${task.title} done`}
      onChange={tick}
    />
  );
}

/**
 * The action cluster of a task row. Inline actions show on the row; the rest live in the menu. A laptop also shows the
 * hand-off icon; a phone puts Ask Claude first in the menu (QA r1 decision 8). With no `actions` given the menu offers Today
 * and Tomorrow, so every list can move a task (QA r2 P04). A task already with Claude is not offered again (QA r2 U10), and a
 * menu with only "Open" is left out, since the title opens the task (QA r2 U15).
 */
export function TaskSide({ task, today: todayProp, onOpen, actions }: { task: Task; today?: string; onOpen: (id: string) => void; actions?: RowAction[] }) {
  const online = useOnline();
  const phone = useIsPhone();
  const clock = useToday();
  const withClaude = useClaudeTaskIds();
  const { askAbout } = useClaudeSheet();
  if (task.status !== 'open') return null;
  const today = todayProp ?? clock;
  const tomorrow = addDays(today, 1);
  const acts: RowAction[] = actions ?? [
    ...(task.planned_for !== today ? [{ label: 'Today', aria: `Plan ${task.title} for today`, onClick: () => void moveTask(task.id, today) }] : []),
    ...(task.planned_for !== tomorrow ? [{ label: 'Tomorrow', aria: `Move ${task.title} to tomorrow`, onClick: () => void moveTask(task.id, tomorrow) }] : []),
  ];
  const hand = !withClaude.has(task.id);
  const ask = { label: 'Ask Claude', aria: `Ask Claude about ${task.title}`, run: () => askAbout(task), icon: <CornerUpRight size={16} aria-hidden /> };
  const inline = acts.filter((a) => a.inline);
  const menu = acts.filter((a) => !a.inline);
  const items = [
    ...(phone && hand ? [ask] : []),
    ...menu.map((a) => ({ label: a.pressed ? `${a.label} (on)` : a.label, aria: a.aria, run: a.onClick, disabled: !online })),
    { label: 'Open', aria: `Open ${task.title} details`, run: () => onOpen(task.id) },
  ];
  return (
    <span className="side">
      {inline.map((a) => (
        <button key={a.label} type="button" className={a.chip ? 'chip' : 'btn sm'} aria-pressed={a.pressed} disabled={!online} aria-label={a.aria} onClick={a.onClick}>{a.label}</button>
      ))}
      {!phone && hand && <button type="button" className="icon-btn ask" aria-label={ask.aria} title="Ask Claude" onClick={ask.run} data-testid="ask-claude"><CornerUpRight size={18} aria-hidden /></button>}
      {items.length > 1 && <ActionMenu label={task.title} items={items} />}
    </span>
  );
}

export function TaskRow({
  task, today, now, onOpen, actions = [],
}: { task: Task; today: string; now: number; onOpen: (id: string) => void; actions?: RowAction[]; showFollowUp?: boolean }) {
  const online = useOnline();
  const isDone = task.status === 'done';
  const dropped = task.status === 'dropped';
  const withClaude = useClaudeTaskIds();
  return (
    <li className={`row ${isDone || dropped ? 'done' : ''} ${rowState(task, withClaude, now)}`} data-testid="task-row" data-task-id={task.id} data-status={task.status}>
      {dropped ? <span style={{ width: 8 }} aria-hidden /> : isDone ? (
        <Check checked disabled={!online} label={`Reopen ${task.title}`} onChange={() => void setTaskDone(task.id, false)} />
      ) : <TaskCheck task={task} />}
      <TaskText task={task} today={today} now={now} onOpen={onOpen} />
      <TaskSide task={task} today={today} onOpen={onOpen} actions={actions} />
    </li>
  );
}
