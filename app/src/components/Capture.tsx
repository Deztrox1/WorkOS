import { useState, type FormEvent } from 'react';
import { Bell, FileText, Sparkles } from 'lucide-react';
import { addTask, calendarWord } from '../lib/actions';
import { useToday } from '../lib/clock';
import { dayMonth, formatDue } from '../lib/logic/format';
import { parseQuickAdd } from '../lib/logic/quickAdd';
import { useMode } from '../lib/mode';
import { useOnline } from '../lib/online';
import { useSlice } from '../lib/store';
import type { Area } from '../lib/types';
import { useClaudeSheet } from './ClaudeSheet';
import { useNoteSheet } from './NoteSheet';
import { useReminderSheet } from './ReminderSheet';
import { Segmented, Sheet } from './ui';

const AREA_KEY = 'workos.add-area';
const lastArea = (): Area | null => {
  try {
    const v = localStorage.getItem(AREA_KEY);
    return v === 'work' || v === 'personal' ? v : null;
  } catch {
    return null;
  }
};

/** The capture line. It lives in its own file so the date parser loads when Add is pressed, not with the first screen. */
export default function Capture({ onClose }: { onClose: () => void }) {
  const today = useToday();
  const { mode } = useMode();
  const online = useOnline();
  const { askFree } = useClaudeSheet();
  const { openNote } = useNoteSheet();
  const { openReminder } = useReminderSheet();
  const [text, setText] = useState('');
  // The area of the last task added, else the mode: never a hidden default (R4P33).
  const [area, setAreaState] = useState<Area>(() => lastArea() ?? mode);
  const setArea = (a: Area) => {
    setAreaState(a);
    try { localStorage.setItem(AREA_KEY, a); } catch { /* ignore */ }
  };
  const linked = useSlice('calendar_state').rows[0]?.linked ?? false;
  const now = Date.now();
  const parsed = text.trim() ? parseQuickAdd(text, now, area) : null;
  const go = (fn: () => void) => () => { onClose(); fn(); };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!parsed || !online) return;
    void addTask(parsed);
    onClose();
  };
  return (
    <Sheet title="Add" onClose={onClose} variant="quick">
      <form onSubmit={submit} aria-label="Quick add" className="capture">
        <input
          className="input" aria-label="Quick add" placeholder="Call Sam tomorrow 3pm 20m #sales" value={text} disabled={!online}
          onChange={(e) => setText(e.target.value)} enterKeyHint="done" autoComplete="off" data-autofocus
        />
        <p className="preview" data-testid="capture-preview" aria-live="polite">
          {parsed ? (
            <><b>Task</b> {parsed.title}{parsed.due_date ? ` · ${formatDue(parsed.due_date, today).text} (${dayMonth(parsed.due_date)})` : ''}{parsed.due_time ? ` ${parsed.due_time}` : ''}{parsed.est_minutes ? ` · ${parsed.est_minutes} min` : ''}{parsed.project ? ` · #${parsed.project}` : ''} · {parsed.area}{parsed.due_date && parsed.due_time ? <span className="preview-cal"> {calendarWord(linked)}</span> : null}</>
          ) : online ? 'Type a task. Enter saves it.' : 'You are offline. Adding is off until you are back.'}
        </p>
        <Segmented label="Add to" value={area} onChange={setArea} options={[{ value: 'personal', label: 'Personal' }, { value: 'work', label: 'Work' }]} />
        <div className="capture-alt" role="group" aria-label="Or add">
          <button type="button" className="btn sm ghost" onClick={go(() => openReminder('new'))}><Bell size={16} aria-hidden />Reminder</button>
          <button type="button" className="btn sm ghost" onClick={go(() => openNote('new'))}><FileText size={16} aria-hidden />Note</button>
          <button type="button" className="btn sm ghost" onClick={go(() => askFree(text.trim() || undefined))}><Sparkles size={16} aria-hidden />Ask Claude</button>
          <button type="submit" className="btn sm primary" disabled={!online || !parsed}>Save task</button>
        </div>
      </form>
    </Sheet>
  );
}
