import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { ChevronDown, ChevronRight, Plus, Search } from 'lucide-react';
import { Check, ListState } from '../components/ui';
import { rowState, TaskCheck, TaskSide, TaskText, useClaudeTaskIds } from '../components/TaskRow';
import { useTaskSheet } from '../components/TaskSheet';
import { addTask, setTaskDone } from '../lib/actions';
import { useToday } from '../lib/clock';
import { formatDue, dayMonth, weekdayShort } from '../lib/logic/format';
import { parseQuickAdd } from '../lib/logic/quickAdd';
import { doneTasks, groupTasks, matchesSearch } from '../lib/logic/tasks';
import { useMode } from '../lib/mode';
import { useOnline } from '../lib/online';
import { store, useSlice } from '../lib/store';
import type { Task } from '../lib/types';
import { diffDays } from '../shared/ist';

/**
 * The time spine of a task row: the due date of an earlier task, a due time, a due day, or the estimate. Blank when there is nothing to say.
 * A screen reader hears "due 1 Sep". No minus sign and no red: the date is plain ink. Line 3 drops the due text for
 * overdue and today rows, so the spine is the only place that says it. Upcoming days and minutes repeat line 3 and stay silent.
 */
function Spine({ task, today }: { task: Task; today: string }) {
  if (task.status !== 'open') return <span className="spine" aria-hidden />;
  const due = task.due_date;
  const diff = due ? diffDays(today, due) : null;
  let body: ReactNode = null;
  if (due && diff !== null && diff < 0) {
    body = <><span className="v" aria-hidden>{dayMonth(due)}</span><span className="sr">due {dayMonth(due)}</span></>;
  } else if (due && diff === 0 && task.due_time) {
    body = <><span className="v" aria-hidden>{task.due_time.slice(0, 5)}</span><span className="sr">due today at {task.due_time.slice(0, 5)}</span></>;
  } else if (due && diff === 0) {
    body = task.est_minutes ? <span className="v soft" aria-hidden>{task.est_minutes}m</span> : <span className="sr">due today</span>;
  } else if (due && diff !== null) {
    body = (
      <span className="v" aria-hidden style={{ display: 'contents' }}>
        <span>{task.due_time ? task.due_time.slice(0, 5) : due.slice(8).replace(/^0/, '')}</span>
        <span className="word small">{diff <= 7 ? weekdayShort(due) : dayMonth(due).split(' ')[1]}</span>
      </span>
    );
  } else if (task.est_minutes) body = <span className="v soft" aria-hidden>{task.est_minutes}m</span>;
  return <span className="spine">{body}</span>;
}

/** A Tasks row on the ruled sheet: spine | check + text | actions. Same row anatomy as Today. */
function Row({ task, today, now, onOpen, claude }: { task: Task; today: string; now: number; onOpen: (id: string) => void; claude: Set<string> }) {
  const online = useOnline();
  const isDone = task.status === 'done';
  const dropped = task.status === 'dropped';
  return (
    <li className={`lrow ${isDone || dropped ? 'done' : ''} ${rowState(task, claude, now)}`} data-testid="task-row" data-task-id={task.id} data-status={task.status}>
      <Spine task={task} today={today} />
      <span className="body">
        {dropped ? <span className="check" aria-hidden /> : isDone ? (
          <Check checked disabled={!online} label={`Reopen ${task.title}`} onChange={() => void setTaskDone(task.id, false)} />
        ) : <TaskCheck task={task} />}
        <TaskText task={task} today={today} now={now} onOpen={onOpen} sheet />
      </span>
      <span className="side"><TaskSide task={task} today={today} onOpen={onOpen} /></span>
    </li>
  );
}

const TONE: Record<string, string> = { today: 'today' };
/** The group of earlier due dates has a quiet name, not a red one. */
const groupLabel = (key: string, label: string) => (key === 'overdue' ? 'Earlier' : label);

export function Tasks() {
  const today = useToday();
  const { mode, both, setBoth } = useMode();
  const online = useOnline();
  const { openTask } = useTaskSheet();
  const tasks = useSlice('tasks');
  const claude = useClaudeTaskIds();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [showDone, setShowDone] = useState(false);
  const now = Date.now();
  const loc = useLocation();
  const addRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (loc.search.includes('add=1')) addRef.current?.focus(); }, [loc.search]);

  const inScope = useMemo(() => tasks.rows.filter((t) => both || t.area === mode), [tasks.rows, mode, both]);
  const open = useMemo(() => inScope.filter((t) => t.status === 'open' && matchesSearch(t, q)), [inScope, q]);
  const groups = useMemo(() => groupTasks(open, today, true), [open, today]);
  const done = useMemo(() => doneTasks(inScope, now).filter((t) => matchesSearch(t, q)), [inScope, now, q]);
  const parsed = text.trim() ? parseQuickAdd(text, now, both ? 'work' : mode) : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!parsed || !online) return;
    setText('');
    await addTask(parsed);
  };

  return (
    <div className="sheetpaper page">
      <div className="page-h">
        <h1>Tasks</h1>
        {tasks.status === 'ready' && <span className="meta">{open.length} open</span>}
      </div>
      <form onSubmit={submit} aria-label="Quick add" className="page-tools">
        <div className="ruled-line quick-line">
          <Plus size={18} aria-hidden />
          <input ref={addRef} aria-label="Quick add" placeholder="Call Sam tomorrow 3pm 20m #sales" value={text} onChange={(e) => setText(e.target.value)} disabled={!online} enterKeyHint="done" />
          {/* Outlined until there is text, then filled. Never greyed out at rest (U20): an empty Add puts the cursor in the line. */}
          <button type="submit" className={`btn sm ${parsed ? 'primary' : ''}`} disabled={!online} onClick={(e) => { if (!parsed) { e.preventDefault(); addRef.current?.focus(); } }}>Add</button>
        </div>
        {parsed && (
          <p className="preview" data-testid="preview" aria-live="polite">
            <b>Title</b> {parsed.title} · <b>Due</b> {parsed.due_date ? `${formatDue(parsed.due_date, today).text} (${dayMonth(parsed.due_date)})` : 'none'} · <b>Time</b> {parsed.due_time ?? 'none'} · <b>Minutes</b> {parsed.est_minutes ?? 'none'} · <b>Project</b> {parsed.project ?? 'none'} · <b>Priority</b> {parsed.priority === 1 ? 'high' : parsed.priority === 3 ? 'low' : 'normal'} · <b>Area</b> {parsed.area}
          </p>
        )}
      </form>
      <div className="page-tools">
        <label className="ruled-line">
          <Search size={16} aria-hidden />
          <input type="search" aria-label="Search tasks" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <button type="button" className="chip tool-chip" aria-pressed={both} onClick={() => setBoth(!both)}>Both areas</button>
      </div>

      <ListState slices={[tasks]} empty={groups.length === 0 && done.length === 0} emptyText="No tasks here." onRetry={() => void store.refresh(['tasks'])}>
        {groups.length === 0 && <p className="empty">No tasks here.</p>}
        {groups.map((g) => (
          <section key={g.key} className="sheet-sec" aria-label={groupLabel(g.key, g.label)} data-testid={`group-${g.key}`}>
            <div className={`sec-h ${TONE[g.key] ?? ''}`}><h2>{groupLabel(g.key, g.label)}</h2><span className="sec-n">{g.tasks.length}</span></div>
            <ul className="list">{g.tasks.map((t) => <Row key={t.id} task={t} today={today} now={now} onOpen={openTask} claude={claude} />)}</ul>
          </section>
        ))}
        <section className={`sheet-sec ${showDone ? '' : 'closed'}`} aria-label="Done">
          <div className="sec-h">
            <h2>
              <button type="button" className="sec-toggle" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
                {showDone ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}Done <span className="mono">({done.length})</span>
              </button>
            </h2>
            <span className="sec-n">last 30 days</span>
          </div>
          {showDone && (
            <ul className="list" data-testid="done-list">
              {done.map((t) => <Row key={t.id} task={t} today={today} now={now} onOpen={openTask} claude={claude} />)}
            </ul>
          )}
        </section>
      </ListState>
    </div>
  );
}
