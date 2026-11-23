import { useMemo } from 'react';
import { Plus } from 'lucide-react';
import { ListState } from '../components/ui';
import { useReminderSheet } from '../components/ReminderSheet';
import { fireText } from '../lib/logic/format';
import { useMode } from '../lib/mode';
import { useOnline } from '../lib/online';
import { store, useSlice } from '../lib/store';
import type { Reminder } from '../lib/types';
import { nextFire } from '../shared/nextFire';
import { istTime } from '../shared/ist';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function repeatLabel(r: Reminder): string {
  switch (r.repeat) {
    case 'none': return 'Once';
    case 'daily': return 'Every day';
    case 'weekdays': return 'Mon to Fri';
    case 'weekly': return `Every week${r.repeat_days?.length ? ' on ' + r.repeat_days.map((d) => DOW[d]).join(', ') : ''}`;
    case 'custom': return (r.repeat_days ?? []).map((d) => DOW[d]).join(', ') || 'Chosen days';
    case 'monthly': return 'Every month';
  }
}

export function Reminders() {
  const { mode } = useMode();
  const online = useOnline();
  const { openReminder } = useReminderSheet();
  const reminders = useSlice('reminders');
  const now = Date.now();
  const rows = useMemo(() => {
    const list = reminders.rows.filter((r) => r.area === mode && !r.snooze_of).map((r) => ({ r, next: r.active ? nextFire(r, now) : null }));
    return list.sort((a, b) => Number(b.r.active) - Number(a.r.active) || (a.next ?? Infinity) - (b.next ?? Infinity));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reminders.rows, mode, Math.floor(now / 60000)]);

  const on = rows.filter((x) => x.r.active);
  const off = rows.filter((x) => !x.r.active);
  const item = ({ r, next }: { r: Reminder; next: number | null }) => (
    <li key={r.id} className={`lrow ${r.active ? '' : 'done'}`} data-testid="reminder-item" data-active={r.active}>
      <span className={`spine ${r.active ? '' : 'soft'}`} aria-hidden>{r.active && next ? istTime(next) : r.time_local ? r.time_local.slice(0, 5) : null}</span>
      <span className="body">
        <button type="button" className="main-btn" onClick={() => openReminder(r.id)}>
          <span className="t1">{r.title}</span>
          {r.notes && <span className="t2 ell1">{r.notes}</span>}
          <span className="t3">{r.active ? (next ? fireText(next, now) : 'No next fire') : 'Off'} · {repeatLabel(r)}</span>
        </button>
      </span>
      <span className="side" />
    </li>
  );

  return (
    <div className="sheetpaper page">
      <div className="page-h">
        <h1>Reminders</h1>
        <button type="button" className="btn ghost add" disabled={!online} onClick={() => openReminder('new')}><Plus size={16} aria-hidden />New reminder</button>
      </div>
      <ListState slices={[reminders]} empty={rows.length === 0} emptyText="No reminders." onRetry={() => void store.refresh(['reminders'])}>
        {on.length > 0 && (
          <section className="sheet-sec" aria-label="On">
            <div className="sec-h"><h2>On</h2><span className="sec-n">next first</span></div>
            <ul className="list">{on.map(item)}</ul>
          </section>
        )}
        {off.length > 0 && (
          <section className="sheet-sec" aria-label="Off">
            <div className="sec-h mute"><h2>Off</h2><span className="sec-n">{off.length}</span></div>
            <ul className="list">{off.map(item)}</ul>
          </section>
        )}
      </ListState>
    </div>
  );
}
