import { useMemo, useState } from 'react';
import { ListState } from '../components/ui';
import { markRead } from '../lib/actions';
import { safeOpen } from '../lib/claude';
import { dayMonth, relTime } from '../lib/logic/format';
import { useMode } from '../lib/mode';
import { useOnline } from '../lib/online';
import { store, useSlice } from '../lib/store';
import type { Severity } from '../lib/types';
import { addDays, istDate, istTime } from '../shared/ist';

/** One Show control: everything, unread only, or one kind of event. */
const SHOW: { value: string; label: string }[] = [
  { value: '', label: 'All' }, { value: 'unread', label: 'Unread' }, { value: 'alert', label: 'Alerts' }, { value: 'reply', label: 'Replies' },
  { value: 'lead', label: 'Leads' }, { value: 'invoice', label: 'Invoices' }, { value: 'campaign', label: 'Campaigns' },
  { value: 'system', label: 'System' }, { value: 'note', label: 'Notes' },
];
const SEV_WORD: Record<Severity, string> = { bad: 'Problem', warn: 'Heads up', info: 'Update', good: 'Good news' };
const KIND_WORD: Record<string, string> = { campaign: 'Campaign', reply: 'Reply', alert: 'Alert', lead: 'Lead', invoice: 'Invoice', system: 'System', note: 'Note' };
const SOURCE_WORD: Record<string, string> = { ops_heartbeat: 'System check', campaign_pulse: 'Campaign check', reply_handler: 'Reply watch', claude: 'Claude', seed: 'Sample data' };
/** A collector name in plain words: a known name gets its label, anything else loses its underscores. */
export function sourceWord(src: string | null): string {
  if (!src) return '';
  if (SOURCE_WORD[src]) return SOURCE_WORD[src];
  const s = src.replace(/[_-]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function Activity() {
  const { mode } = useMode();
  const online = useOnline();
  const events = useSlice('events');
  const [show, setShow] = useState('');
  const now = Date.now();
  const today = istDate(now);
  const rows = useMemo(
    () => events.rows.filter((e) => e.area === mode && (show !== 'unread' || !e.read_at) && (!show || show === 'unread' || e.kind === show)),
    [events.rows, mode, show],
  );
  const more = events.rows.length >= store.eventsLimit;
  const unread = rows.filter((e) => !e.read_at).length;
  const open = (id: string, url: string | null, read: boolean) => {
    if (!read) void markRead([id]);
    safeOpen(url);
  };
  const dayOf = (iso: string) => istDate(new Date(iso).getTime());
  const sections = [
    { key: 'today', label: 'Today', rows: rows.filter((e) => dayOf(e.occurred_at) === today) },
    { key: 'yesterday', label: 'Yesterday', rows: rows.filter((e) => dayOf(e.occurred_at) === addDays(today, -1)) },
    { key: 'earlier', label: 'Earlier', rows: rows.filter((e) => dayOf(e.occurred_at) < addDays(today, -1)) },
  ].filter((s) => s.rows.length > 0);

  return (
    <div className="sheetpaper page">
      <div className="page-h">
        <h1>Activity</h1>
        <button type="button" className="btn ghost" disabled={!online || rows.every((e) => e.read_at)} onClick={() => void markRead(rows.filter((e) => !e.read_at).map((e) => e.id))}>Mark all read</button>
      </div>
      <div className="page-tools">
        <label className="show-select">
          Show
          <select value={show} onChange={(e) => setShow(e.target.value)} data-testid="show">
            {SHOW.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        {rows.length > 0 && <span className="hint mono">{unread} unread</span>}
      </div>
      <ListState slices={[events]} empty={rows.length === 0} emptyText="Nothing new. Problems and updates show here when they happen." onRetry={() => void store.refresh(['events', 'unread'])}>
        {sections.map((sec) => (
          <section key={sec.key} className="sheet-sec" aria-label={sec.label}>
            <div className="sec-h"><h2>{sec.label}</h2><span className="sec-n">{sec.rows.length}</span></div>
            <ul className="list">
              {sec.rows.map((e) => {
                const at = new Date(e.occurred_at).getTime();
                const [d, m] = dayMonth(istDate(at)).split(' ');
                return (
                  <li key={e.id} className={`lrow ${e.read_at ? 'read' : ''}`} data-testid="feed-row" data-read={!!e.read_at} data-severity={e.severity}>
                    <span className="spine" aria-hidden>{sec.key === 'earlier' ? <><span>{d}</span><span className="word small">{m}</span></> : istTime(at)}</span>
                    <span className="body">
                      <button type="button" className="main-btn" onClick={() => open(e.id, e.url, !!e.read_at)}>
                        <span className={`sev ${e.severity}`}><span className={`dot ${e.severity}`} aria-hidden />{SEV_WORD[e.severity] ?? 'Update'}{!e.read_at && <span className="sr"> unread</span>}</span>
                        <span className="t1 ell2">{e.title}</span>
                        {e.body && <span className="t2 ell2">{e.body}</span>}
                        <span className="t3">{[KIND_WORD[e.kind] ?? e.kind, sourceWord(e.source), relTime(e.occurred_at, now)].filter(Boolean).join(' · ')}</span>
                      </button>
                    </span>
                    <span className="side" />
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        {more && rows.length > 0 && <button type="button" className="btn" style={{ marginTop: 12 }} onClick={() => void store.loadMoreEvents()}>Load more</button>}
      </ListState>
    </div>
  );
}
