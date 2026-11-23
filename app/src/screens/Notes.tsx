import { useMemo, useState } from 'react';
import { Pin, PinOff, ListPlus, Search } from 'lucide-react';
import { ListState } from '../components/ui';
import { Plus } from 'lucide-react';
import { makeTaskFromNote, useNoteSheet } from '../components/NoteSheet';
import { pinNote } from '../lib/actions';
import { dayMonth } from '../lib/logic/format';
import { istDate } from '../shared/ist';
import { useMode } from '../lib/mode';
import { useOnline } from '../lib/online';
import { store, useSlice } from '../lib/store';
import type { Note } from '../lib/types';

/** Markdown-lite: line breaks and "- " bullets only. Everything else is plain text. */
export function NoteBody({ body }: { body: string }) {
  const blocks: ({ t: 'p'; v: string } | { t: 'ul'; v: string[] })[] = [];
  for (const line of body.split('\n')) {
    const m = /^\s*[-*]\s+(.*)$/.exec(line);
    if (m) {
      const last = blocks[blocks.length - 1];
      if (last && last.t === 'ul') last.v.push(m[1]);
      else blocks.push({ t: 'ul', v: [m[1]] });
    } else blocks.push({ t: 'p', v: line });
  }
  return (
    <div className="note-body sec">
      {blocks.map((b, i) => b.t === 'ul' ? <ul key={i}>{b.v.map((x, j) => <li key={j}>{x}</li>)}</ul> : <p key={i}>{b.v}</p>)}
    </div>
  );
}

export function sortNotes(notes: Note[]): Note[] {
  // pinned first (oldest note first, so a new pin goes after the existing ones), then newest note first (pinning never reshuffles the rest)
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return Number(b.pinned) - Number(a.pinned);
    if (a.pinned) return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
    return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
  });
}

export function Notes() {
  const { mode } = useMode();
  const online = useOnline();
  const { openNote } = useNoteSheet();
  const notes = useSlice('notes');
  const [q, setQ] = useState('');
  const rows = useMemo(
    () => sortNotes(notes.rows.filter((n) => n.area === mode && `${n.title} ${n.body}`.toLowerCase().includes(q.trim().toLowerCase()))),
    [notes.rows, mode, q],
  );
  const pinned = rows.filter((n) => n.pinned);
  const rest = rows.filter((n) => !n.pinned);
  const card = (n: Note) => (
    <li key={n.id} className="lrow" data-testid="note-card" data-pinned={n.pinned}>
      <span className="spine" aria-hidden>
        {(() => { const [d, m] = dayMonth(istDate(new Date(n.created_at).getTime())).split(' '); return <><span>{d}</span><span className="word small">{m}</span></>; })()}
      </span>
      <span className="body">
        <button type="button" className="main-btn" onClick={() => openNote(n.id)} aria-label={`Open note ${n.title}`}>
          <span className="t1">{n.pinned && <Pin size={14} fill="currentColor" aria-label="Pinned" role="img" style={{ color: 'var(--acc)', marginRight: 6, verticalAlign: '-1px' }} />}{n.title || 'Untitled'}</span>
          <NoteBody body={n.body} />
        </button>
      </span>
      <span className="side">
        <button type="button" className={`icon-btn ${n.pinned ? 'acc' : ''}`} aria-pressed={n.pinned} aria-label={n.pinned ? `Unpin ${n.title}` : `Pin ${n.title}`} title={n.pinned ? 'Unpin' : 'Pin'} disabled={!online} onClick={() => void pinNote(n.id, !n.pinned)}>
          {n.pinned ? <PinOff size={18} aria-hidden /> : <Pin size={18} aria-hidden />}
        </button>
        <button type="button" className="icon-btn" aria-label={`Make task from ${n.title}`} title="Make task" disabled={!online} onClick={() => void makeTaskFromNote(n)}><ListPlus size={18} aria-hidden /></button>
      </span>
    </li>
  );
  return (
    <div className="sheetpaper page">
      <div className="page-h"><h1>Notes</h1><button type="button" className="btn ghost add" onClick={() => openNote('new')}><Plus size={16} aria-hidden />New note</button></div>
      <div className="page-tools">
        <label className="ruled-line">
          <Search size={16} aria-hidden />
          <input type="search" aria-label="Search notes" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <ListState slices={[notes]} empty={rows.length === 0} emptyText="No notes yet." onRetry={() => void store.refresh(['notes'])}>
        {pinned.length > 0 && (
          <section className="sheet-sec" aria-label="Pinned">
            <div className="sec-h"><h2>Pinned</h2><span className="sec-n">{pinned.length}</span></div>
            <ul className="list">{pinned.map(card)}</ul>
          </section>
        )}
        {rest.length > 0 && (
          <section className="sheet-sec" aria-label="Notes">
            <div className="sec-h"><h2>{pinned.length ? 'The rest' : 'Newest first'}</h2><span className="sec-n">{rest.length}</span></div>
            <ul className="list">{rest.map(card)}</ul>
          </section>
        )}
      </ListState>
    </div>
  );
}
