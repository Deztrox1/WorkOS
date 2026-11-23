import { createContext, useContext, useState, type ReactNode } from 'react';
import { calendarWord, deleteTask, dropTask, followedUp, reopenTask, saveTaskEdits, setTaskDone } from '../lib/actions';
import { dayMonth, timeText } from '../lib/logic/format';
import { isFollowUp } from '../lib/logic/tasks';
import { useOnline } from '../lib/online';
import { useSlice } from '../lib/store';
import type { Task } from '../lib/types';
import { addDays, istDate, istTime } from '../shared/ist';
import { Confirm, Field, Sheet } from './ui';

type Ctx = { openTask: (id: string) => void };
const TaskSheetCtx = createContext<Ctx>({ openTask: () => {} });
export const useTaskSheet = () => useContext(TaskSheetCtx);

export function TaskSheetProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState<string | null>(null);
  const tasks = useSlice('tasks');
  const task = id ? tasks.rows.find((t) => t.id === id) : undefined;
  return (
    <TaskSheetCtx.Provider value={{ openTask: setId }}>
      {children}
      {task && <TaskSheet key={task.id} task={task} onClose={() => setId(null)} />}
    </TaskSheetCtx.Provider>
  );
}

const stamp = (iso: string) => `${dayMonth(istDate(new Date(iso).getTime()))} ${timeText(iso)}`;
/** Where a task came from, in plain words. Unknown names lose their underscores. */
const SOURCE_WORD: Record<string, string> = { idle_inventory: 'the idle list', user: 'you', claude: 'a Claude session', note: 'a note' };
const sourceWord = (src: string) => SOURCE_WORD[src] ?? src.replace(/[_-]+/g, ' ');
const nstr = (v: string) => (v.trim() === '' ? null : v.trim());
const nnum = (v: string) => (v.trim() === '' ? null : Number(v));

function TaskSheet({ task, onClose }: { task: Task; onClose: () => void }) {
  const online = useOnline();
  const linked = useSlice('calendar_state').rows[0]?.linked ?? false;
  const [d, setD] = useState({
    title: task.title, notes: task.notes ?? '', due_date: task.due_date ?? '', due_time: task.due_time?.slice(0, 5) ?? '',
    planned_for: task.planned_for ?? '', priority: String(task.priority), est_minutes: task.est_minutes?.toString() ?? '',
    project: task.project ?? '', waiting_on: task.waiting_on ?? '', next_action: task.next_action ?? '',
    cost_usd: task.cost_usd?.toString() ?? '', area: task.area,
  });
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof d) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });

  // A time needs a day: the planned day, else today while the time is ahead, else tomorrow (R4P14).
  const today = istDate(Date.now());
  const impliedDay = d.due_time && !d.due_date ? d.planned_for || (d.due_time > istTime(Date.now()) ? today : addDays(today, 1)) : null;
  const dueDate = nstr(d.due_date) ?? impliedDay;
  const patch = () => ({
    title: d.title.trim() || task.title, notes: nstr(d.notes), due_date: dueDate, due_time: nstr(d.due_time),
    planned_for: nstr(d.planned_for), priority: Number(d.priority), est_minutes: nnum(d.est_minutes), project: nstr(d.project),
    waiting_on: nstr(d.waiting_on), next_action: nstr(d.next_action), cost_usd: nnum(d.cost_usd), area: d.area,
  });
  // The task as it was when the sheet opened: only fields changed since then are sent, so an edit made
  // elsewhere in the meantime (another device, the follow-up note line) survives.
  const [opening] = useState(() => ({
    title: task.title, notes: task.notes, due_date: task.due_date, due_time: task.due_time?.slice(0, 5) ?? null, planned_for: task.planned_for,
    priority: task.priority, est_minutes: task.est_minutes, project: task.project, waiting_on: task.waiting_on, next_action: task.next_action,
    cost_usd: task.cost_usd, area: task.area,
  }));
  /** Numbers the database would refuse. Checked before the sheet closes so one bad value never loses the other edits. */
  const numberError = () => {
    const m = d.est_minutes.trim();
    if (m !== '' && !(/^\d+$/.test(m))) return 'Minutes must be a whole number, 0 or more.';
    const c = d.cost_usd.trim();
    if (c !== '' && !(Number.isFinite(Number(c)) && Number(c) >= 0 && Number(c) <= 99999999.99)) return 'Cost must be between 0 and 99,999,999.99.';
    return '';
  };
  const close = () => {
    const bad = numberError();
    if (bad) { setError(bad); return; }
    if (online) {
      const p = patch();
      const timeChanged = p.due_date !== opening.due_date || p.due_time !== opening.due_time;
      void saveTaskEdits(task.id, opening, p, timeChanged ? { pushed_at: null } : {});
    }
    onClose();
  };
  const closed = task.status !== 'open';
  const act = (fn: () => Promise<boolean>) => async () => {
    await fn();
    onClose();
  };

  return (
    <>
      <Sheet
        title="Task"
        onClose={close}
        footer={
          <>
            {task.status === 'open' && isFollowUp(task) && <button type="button" className="btn primary" disabled={!online} onClick={act(() => followedUp(task, istDate(Date.now())))}>Done</button>}
            {task.status === 'open' && !isFollowUp(task) && <button type="button" className="btn primary" disabled={!online} onClick={act(() => setTaskDone(task.id, true))}>Done</button>}
            {task.status === 'open' && <button type="button" className="btn" disabled={!online} onClick={act(() => dropTask(task.id))}>Drop</button>}
            {closed && <button type="button" className="btn primary" disabled={!online} onClick={act(() => reopenTask(task.id))}>Reopen</button>}
            <button type="button" className="btn danger" disabled={!online} onClick={() => setConfirm(true)}>Delete</button>
          </>
        }
      >
        <Field label="Title"><input value={d.title} onChange={set('title')} /></Field>
        <Field label="Notes"><textarea value={d.notes} onChange={set('notes')} /></Field>
        <div className="field-pair">
          <Field label="Due date"><input type="date" min="2000-01-01" max="2100-12-31" value={d.due_date} onChange={set('due_date')} /></Field>
          <Field label="Due time" hint={d.due_time ? `${impliedDay ? `A time needs a day, so this is set for ${dayMonth(impliedDay)}. ` : ''}${calendarWord(linked)}` : undefined}><input type="time" value={d.due_time} onChange={set('due_time')} /></Field>
        </div>
        <div className="field-pair">
          <Field label="Planned for"><input type="date" value={d.planned_for} onChange={set('planned_for')} /></Field>
          <Field label="Priority">
            <select value={d.priority} onChange={set('priority')}>
              <option value="1">High</option><option value="2">Normal</option><option value="3">Low</option>
            </select>
          </Field>
        </div>
        <div className="field-pair">
          <Field label="Minutes it takes"><input type="number" min="0" inputMode="numeric" value={d.est_minutes} onChange={set('est_minutes')} /></Field>
          <Field label="Project"><input value={d.project} onChange={set('project')} /></Field>
        </div>
        <Field label="Needs"><input value={d.waiting_on} onChange={set('waiting_on')} /></Field>
        <Field label="Next action"><input value={d.next_action} onChange={set('next_action')} /></Field>
        <div className="field-pair">
          <Field label="Cost (USD)"><input type="number" min="0" step="0.01" inputMode="decimal" value={d.cost_usd} onChange={set('cost_usd')} /></Field>
          <Field label="Personal or work">
            <select value={d.area} onChange={set('area')}><option value="work">Work</option><option value="personal">Personal</option></select>
          </Field>
        </div>
        <dl className="kv" aria-label="Task info">
          <dt>Came from</dt><dd>{sourceWord(task.source)}</dd>
          <dt>Added</dt><dd className="mono">{stamp(task.created_at)}</dd>
          <dt>Changed</dt><dd className="mono">{stamp(task.updated_at)}</dd>
        </dl>
        {error && <p className="err" role="alert">{error}</p>}
      </Sheet>
      {confirm && (
        <Confirm
          text="Delete this task? This cannot be undone."
          onCancel={() => setConfirm(false)}
          onConfirm={async () => {
            setConfirm(false);
            await deleteTask(task.id);
            onClose();
          }}
        />
      )}
    </>
  );
}
