import { useMemo, useState } from 'react';
import { Archive, ChevronDown, ChevronRight, Pencil, Plus, RotateCcw } from 'lucide-react';
import { ActionMenu } from '../components/TaskRow';
import { Field, ListState, Sheet, Time24, isTime24 } from '../components/ui';
import { saveHabit, tickHabit, toggleHabitDay } from '../lib/actions';
import { useToday } from '../lib/clock';
import { weekdayOf } from '../shared/ist';
import { bestStreak, currentStreak, strip } from '../lib/logic/habits';
import { weekdayShort } from '../lib/logic/format';
import { useMode } from '../lib/mode';
import { useOnline } from '../lib/online';
import { store, useSlice } from '../lib/store';
import type { Habit } from '../lib/types';

const WD1 = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function HabitSheet({ habit, onClose }: { habit?: Habit; onClose: () => void }) {
  const { mode } = useMode();
  const online = useOnline();
  const [name, setName] = useState(habit?.name ?? '');
  const [days, setDays] = useState<number[]>(habit?.days ?? [0, 1, 2, 3, 4, 5, 6]);
  const [time, setTime] = useState(habit?.time_local?.slice(0, 5) ?? '');
  const [active, setActive] = useState(habit?.active ?? true);
  const [error, setError] = useState('');
  const save = async () => {
    if (!name.trim()) { setError('Add a name.'); return; }
    if (!days.length) { setError('Pick at least one day.'); return; }
    if (time && !isTime24(time)) { setError('Time must be 24 hour, like 21:00.'); return; }
    const ok = await saveHabit({ ...(habit ? { id: habit.id } : { area: mode }), name: name.trim(), days, time_local: time || null, active });
    if (ok) onClose();
  };
  return (
    <Sheet title={habit ? 'Habit' : 'New habit'} onClose={onClose} footer={<button type="button" className="btn primary" disabled={!online} onClick={() => void save()}>Save</button>}>
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <div className="field">
        <span className="lbl">Days</span>
        <div className="chips" role="group" aria-label="Days">
          {DOW.map((n, i) => (
            <button key={n} type="button" className="chip" aria-pressed={days.includes(i)} onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i].sort())}>{n}</button>
          ))}
        </div>
      </div>
      <Field label="Time (IST, optional)"><Time24 value={time} onChange={setTime} /></Field>
      <label className="field-check">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /><span>Active</span>
      </label>
      {error && <p className="err" role="alert">{error}</p>}
    </Sheet>
  );
}

export function Habits() {
  const today = useToday();
  const { mode } = useMode();
  const online = useOnline();
  const habits = useSlice('habits');
  const logs = useSlice('habit_logs');
  const [edit, setEdit] = useState<Habit | 'new' | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const mine = useMemo(() => habits.rows.filter((h) => h.area === mode).sort((a, b) => (a.time_local ? (b.time_local ? a.time_local.localeCompare(b.time_local) : -1) : b.time_local ? 1 : 0) || a.sort_order - b.sort_order), [habits.rows, mode]);
  const active = mine.filter((h) => h.active);
  const archived = mine.filter((h) => !h.active);

  const doneToday = active.filter((h) => logs.rows.some((l) => l.habit_id === h.id && l.day === today && l.done)).length;
  return (
    <div className="sheetpaper page">
      <div className="page-h">
        <h1>Habits</h1>
        <span className="acts">
          {active.length > 0 && <span className="meta">{doneToday} of {active.length} today</span>}
          <button type="button" className="btn ghost add" disabled={!online} onClick={() => setEdit('new')}><Plus size={16} aria-hidden />New habit</button>
        </span>
      </div>
      <ListState slices={[habits, logs]} empty={mine.length === 0} emptyText="No habits yet." onRetry={() => void store.refresh(['habits', 'habit_logs'])}>
        <section className="sheet-sec" aria-label="Last 14 days">
          <div className="sec-h"><h2>Last 14 days</h2><span className="sec-n">tap a day to tick it</span></div>
          <ul className="list">
            {active.map((h) => {
              const hl = logs.rows.filter((l) => l.habit_id === h.id);
              const cells = strip(h, hl, today);
              const cur = currentStreak(h, hl, today);
              const best = bestStreak(h, hl, today);
              return (
                <li key={h.id} className="lrow habit" data-testid="habit-item" data-habit={h.name}>
                  <span className={`spine ${h.time_local ? '' : 'soft'}`} aria-hidden>{h.time_local ? h.time_local.slice(0, 5) : <span className="word small">any</span>}</span>
                  <span className="body">
                    <button type="button" className="main-btn" aria-label={`Edit ${h.name}`} onClick={() => setEdit(h)}>
                      <span className="t1">{h.name}</span>
                      {(cur > 0 || best > 0) && (
                        <span className="t3">
                          {cur > 0 && <span data-testid="streak">streak {cur}</span>}
                          {cur > 0 && best > 0 && ' · '}
                          {best > 0 && <span data-testid="best" className={best === cur ? 'best' : ''}>best {best}</span>}
                        </span>
                      )}
                    </button>
                  </span>
                  <span className="side">
                    <ActionMenu
                      label={h.name}
                      items={[
                        { label: 'Edit', aria: `Edit ${h.name} details`, run: () => setEdit(h), icon: <Pencil size={16} aria-hidden /> },
                        { label: 'Archive', aria: `Archive ${h.name}`, run: () => void saveHabit({ id: h.id, name: h.name, active: false }), disabled: !online, icon: <Archive size={16} aria-hidden /> },
                      ]}
                    />
                  </span>
                  <div
                    className="strip" role="group" aria-label={`${h.name} last 14 days`}
                    ref={(el) => { if (el && !el.dataset.seen) { el.dataset.seen = '1'; el.scrollLeft = el.scrollWidth; } }}
                  >
                    {cells.map((c) => (
                      <button
                        key={c.day} type="button" data-state={c.state} data-day={c.day} data-today={c.day === today} disabled={!online}
                        aria-label={`${h.name} ${weekdayShort(c.day)} ${c.day.slice(8)} ${c.state === 'missed' ? 'not done' : c.state === 'off' ? 'rest day' : c.day === today && c.state === 'open' ? 'today' : c.state}`}
                        onClick={() => void (c.state !== 'done' && c.day === today ? tickHabit(h, today) : toggleHabitDay(h.id, c.day, c.state !== 'done'))}
                      ><span /><i aria-hidden>{WD1[weekdayOf(c.day)]}</i></button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
        {archived.length > 0 && (
          <section className={`sheet-sec ${showArchived ? '' : 'closed'}`} aria-label="Archived">
            <div className="sec-h">
              <h2>
                <button type="button" className="sec-toggle" aria-expanded={showArchived} onClick={() => setShowArchived(!showArchived)}>
                  {showArchived ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}Archived <span className="mono">({archived.length})</span>
                </button>
              </h2>
            </div>
            {showArchived && (
              <ul className="list">
                {archived.map((h) => (
                  <li key={h.id} className="lrow done" data-testid="archived-item">
                    <span className="spine soft" aria-hidden>{h.time_local ? h.time_local.slice(0, 5) : null}</span>
                    <span className="body"><span className="txt"><span className="t1">{h.name}</span></span></span>
                    <span className="side"><button type="button" className="btn sm" disabled={!online} onClick={() => void saveHabit({ id: h.id, name: h.name, active: true })}><RotateCcw size={14} aria-hidden />Restore</button></span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </ListState>
      {edit && <HabitSheet key={edit === 'new' ? 'new' : edit.id} habit={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}
