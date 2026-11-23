import { createContext, useContext, useState, type ReactNode } from 'react';
import { addTask, deleteNote, saveNote } from '../lib/actions';
import { useMode } from '../lib/mode';
import { useOnline } from '../lib/online';
import { useSlice } from '../lib/store';
import type { Note } from '../lib/types';
import { Confirm, Field, Sheet } from './ui';

type Ctx = { openNote: (id: string | 'new') => void };
const Ctx = createContext<Ctx>({ openNote: () => {} });
export const useNoteSheet = () => useContext(Ctx);

export function NoteSheetProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState<string | null>(null);
  const notes = useSlice('notes');
  const n = id && id !== 'new' ? notes.rows.find((x) => x.id === id) : undefined;
  return (
    <Ctx.Provider value={{ openNote: setId }}>
      {children}
      {id === 'new' && <NoteSheet key="new" onClose={() => setId(null)} />}
      {n && <NoteSheet key={n.id} note={n} onClose={() => setId(null)} />}
    </Ctx.Provider>
  );
}

export function makeTaskFromNote(n: Note) {
  const title = n.title.trim() || n.body.split('\n')[0].trim() || 'Note';
  return addTask(
    { title, due_date: null, due_time: null, est_minutes: null, project: null, priority: 2, area: n.area },
    { notes: n.body.trim() || null, source: 'note', source_ref: n.id },
  );
}

function NoteSheet({ note, onClose }: { note?: Note; onClose: () => void }) {
  const { mode } = useMode();
  const online = useOnline();
  const [title, setTitle] = useState(note?.title ?? '');
  const [body, setBody] = useState(note?.body ?? '');
  const [confirm, setConfirm] = useState(false);
  const save = async () => {
    if (!title.trim() && !body.trim()) { onClose(); return; }
    const ok = await saveNote({ ...(note ? { id: note.id } : {}), title: title.trim(), body }, mode);
    if (ok) onClose();
  };
  return (
    <>
      <Sheet
        title={note ? 'Note' : 'New note'}
        onClose={onClose}
        footer={
          <>
            <button type="button" className="btn primary" disabled={!online} onClick={() => void save()}>Save</button>
            {note && <button type="button" className="btn" disabled={!online} onClick={async () => { await makeTaskFromNote(note); onClose(); }}>Make task</button>}
            {note && <button type="button" className="btn danger" disabled={!online} onClick={() => setConfirm(true)}>Delete</button>}
          </>
        }
      >
        <Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} data-autofocus={note ? undefined : true} /></Field>
        <Field label="Note" hint="Line breaks and bullets that start with a dash."><textarea style={{ minHeight: 216 }} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      </Sheet>
      {confirm && note && (
        <Confirm text="Delete this note?" onCancel={() => setConfirm(false)} onConfirm={async () => { setConfirm(false); await deleteNote(note.id); onClose(); }} />
      )}
    </>
  );
}
