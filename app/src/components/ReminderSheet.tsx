import { createContext, useContext, useState, type ReactNode } from 'react';
import { deleteReminder, saveReminder } from '../lib/actions';
import { useMode } from '../lib/mode';
import { useOnline } from '../lib/online';
import { useSlice } from '../lib/store';
import type { Reminder, Repeat } from '../lib/types';
import { istDate, istParts, istToMs, weekdayOf } from '../shared/ist';
import { monthlyAnchor, neverFires } from '../shared/nextFire';
import { Confirm, Field, Sheet, Time24, isTime24 } from './ui';

type Ctx = { openReminder: (id: string | 'new') => void };
const Ctx = createContext<Ctx>({ openReminder: () => {} });
export const useReminderSheet = () => useContext(Ctx);

export function ReminderSheetProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState<string | null>(null);
  const reminders = useSlice('reminders');
  const r = id && id !== 'new' ? reminders.rows.find((x) => x.id === id) : undefined;
  return (
    <Ctx.Provider value={{ openReminder: setId }}>
      {children}
      {id === 'new' && <ReminderSheet key="new" onClose={() => setId(null)} />}
      {r && <ReminderSheet key={r.id} reminder={r} onClose={() => setId(null)} />}
    </Ctx.Provider>
  );
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const REPEATS: { value: Repeat; label: string }[] = [
  { value: 'none', label: 'Does not repeat' }, { value: 'daily', label: 'Every day' }, { value: 'weekdays', label: 'Mon to Fri' },
  { value: 'weekly', label: 'Every week' }, { value: 'custom', label: 'Chosen days' }, { value: 'monthly', label: 'Every month' },
];
const toLocal = (iso: string | null) => {
  if (!iso) return '';
  const p = istParts(new Date(iso).getTime());
  const z = (n: number) => String(n).padStart(2, '0');
  return `${p.y}-${z(p.m)}-${z(p.d)}T${z(p.hh)}:${z(p.mm)}`;
};

export function ReminderSheet({ reminder, onClose }: { reminder?: Reminder; onClose: () => void }) {
  const { mode } = useMode();
  const online = useOnline();
  const tasks = useSlice('tasks');
  const now = Date.now();
  const [title, setTitle] = useState(reminder?.title ?? '');
  const [notes, setNotes] = useState(reminder?.notes ?? '');
  const [area, setArea] = useState<string>(reminder?.area ?? mode);
  const [repeat, setRepeat] = useState<Repeat>(reminder?.repeat ?? 'none');
  const local = toLocal(reminder?.remind_at ?? null);
  const [atDate, setAtDate] = useState(local.slice(0, 10));
  const [time, setTime] = useState(reminder?.time_local?.slice(0, 5) ?? (local ? local.slice(11, 16) : '09:00'));
  const [days, setDays] = useState<number[]>(reminder?.repeat_days ?? []);
  const [dom, setDom] = useState(reminder?.remind_at ? String(istParts(new Date(reminder.remind_at).getTime()).d) : String(istParts(now).d));
  const [taskId, setTaskId] = useState(reminder?.task_id ?? '');
  const [active, setActive] = useState(reminder?.active ?? true);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);

  const build = (): Partial<Reminder> => {
    const base = { title: title.trim(), notes: notes.trim() || null, area: area as Reminder['area'], repeat, active, task_id: taskId || null };
    if (repeat === 'none') {
      return { ...base, remind_at: atDate ? new Date(istToMs(atDate, time)).toISOString() : null, time_local: null, repeat_days: [] };
    }
    if (repeat === 'monthly') {
      const remindAt = monthlyAnchor(Number(dom), now, time);
      return { ...base, remind_at: new Date(remindAt).toISOString(), time_local: time, repeat_days: [] };
    }
    if (repeat === 'weekly' || repeat === 'custom') {
      const chosen = days.length ? days : repeat === 'weekly' ? [weekdayOf(istDate(now))] : [];
      return { ...base, remind_at: null, time_local: time, repeat_days: chosen };
    }
    return { ...base, remind_at: null, time_local: time, repeat_days: [] };
  };

  const save = async () => {
    if (!title.trim()) { setError('Add a title.'); return; }
    if (!isTime24(time)) { setError('Time must be 24 hour, like 09:00 or 21:30.'); return; }
    if (repeat === 'none' && !atDate) { setError('Pick a date.'); return; }
    const b = build();
    if (active && neverFires({ repeat: b.repeat!, remind_at: b.remind_at, time_local: b.time_local, repeat_days: b.repeat_days }, now)) {
      setError(repeat === 'none' ? 'That time has passed. Pick a time ahead.' : 'Pick at least one day.');
      return;
    }
    setError('');
    const ok = await saveReminder({ ...(reminder ? { id: reminder.id } : {}), ...b, title: title.trim() });
    if (ok) onClose();
  };

  const toggleDay = (d: number) => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort());
  const linked = tasks.rows.find((t) => t.id === taskId);

  return (
    <>
      <Sheet
        title={reminder ? 'Reminder' : 'New reminder'}
        onClose={onClose}
        footer={
          <>
            <button type="button" className="btn primary" disabled={!online} onClick={() => void save()}>Save</button>
            {reminder && <button type="button" className="btn danger" disabled={!online} onClick={() => setConfirm(true)}>Delete</button>}
          </>
        }
      >
        <Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} data-autofocus={reminder ? undefined : true} /></Field>
        <Field label="Notes"><textarea style={{ resize: 'none' }} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <div className="field-pair">
          <Field label="Personal or work">
            <select value={area} onChange={(e) => setArea(e.target.value)}><option value="work">Work</option><option value="personal">Personal</option></select>
          </Field>
          <Field label="Repeat">
            <select value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)}>
              {REPEATS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </Field>
        </div>
        <div className="field-pair">
          {repeat === 'none' && <Field label="Date (IST)"><input type="date" value={atDate} onChange={(e) => setAtDate(e.target.value)} /></Field>}
          <Field label="Time (IST)"><Time24 value={time} onChange={setTime} /></Field>
        </div>
        {(repeat === 'weekly' || repeat === 'custom') && (
          <div className="field">
            <span className="lbl">Days</span>
            <div className="chips" role="group" aria-label="Days">
              {DOW.map((n, i) => (
                <button key={n} type="button" className="chip" aria-pressed={days.includes(i)} onClick={() => toggleDay(i)}>{n}</button>
              ))}
            </div>
            {repeat === 'weekly' && <span className="hint">No day chosen means today's weekday.</span>}
          </div>
        )}
        {repeat === 'monthly' && <Field label="Day of month"><input type="number" min="1" max="31" value={dom} onChange={(e) => setDom(e.target.value)} /></Field>}
        <Field label="For task">
          <select value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            <option value="">None</option>
            {tasks.rows.filter((t) => t.status === 'open' || t.id === taskId).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </Field>
        {linked && <p className="hint">For task: {linked.title}</p>}
        <label className="field-check">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <span>On</span>
        </label>
        {error && <p className="err" role="alert">{error}</p>}
      </Sheet>
      {confirm && reminder && (
        <Confirm text="Delete this reminder?" onCancel={() => setConfirm(false)} onConfirm={async () => { setConfirm(false); await deleteReminder(reminder.id); onClose(); }} />
      )}
    </>
  );
}

