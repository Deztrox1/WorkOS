import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { completeTask } from '../lib/actions';
import { BRIEF_CAP, CLAUDE_CODE_URL, TITLE_CAP, copyText, finalBrief, notesWithResult, safeOpen, taskBrief } from '../lib/claude';
import { askClaude, closeClaudeForTask, handOffClaude, seeClaude } from '../lib/claudeActions';
import { useToday } from '../lib/clock';
import { useMode } from '../lib/mode';
import { useOnline } from '../lib/online';
import { useSlice } from '../lib/store';
import { toast } from '../lib/toast';
import type { ClaudeRequest, Task } from '../lib/types';
import { Field, Sheet } from './ui';

type Open =
  | { kind: 'ask'; task?: Task; text?: string; title?: string }
  | { kind: 'result'; request: ClaudeRequest }
  | null;
type Ctx = {
  askAbout: (task: Task) => void;
  askFree: (text?: string, title?: string) => void;
  /** The full answer to a request: its text, the session link, and what to do with the task. */
  openResult: (request: ClaudeRequest) => void;
};
const C = createContext<Ctx>({ askAbout: () => {}, askFree: () => {}, openResult: () => {} });
export const useClaudeSheet = () => useContext(C);

export function ClaudeSheetProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<Open>(null);
  const close = () => setOpen(null);
  return (
    <C.Provider
      value={{
        askAbout: (task) => setOpen({ kind: 'ask', task }),
        askFree: (text, title) => setOpen({ kind: 'ask', text, title }),
        openResult: (request) => setOpen({ kind: 'result', request }),
      }}
    >
      {children}
      {open?.kind === 'ask' && <ClaudeSheet key={open.task?.id ?? 'free'} task={open.task} text={open.text} title={open.title} onClose={close} />}
      {open?.kind === 'result' && <ResultSheet key={open.request.id} id={open.request.id} fallback={open.request} onClose={close} />}
    </C.Provider>
  );
}

/**
 * Hand a task or a free request to Claude Code. While Claude cannot start by itself, the one main button copies the brief,
 * opens Claude Code and marks the task as with Claude; Send is hidden because nothing would run it (QA r2 P07, C01).
 */
function ClaudeSheet({ task, text, title: startTitle, onClose }: { task?: Task; text?: string; title?: string; onClose: () => void }) {
  const today = useToday();
  const online = useOnline();
  const { mode } = useMode();
  const settings = useSlice('settings');
  const linked = settings.rows.some((r) => r.key === 'claude_routine' && (r.value as { linked?: boolean } | null)?.linked);
  const [title, setTitle] = useState(task?.title ?? startTitle ?? '');
  const [brief, setBrief] = useState(task ? taskBrief(task, today) : (text ?? ''));
  const [saving, setSaving] = useState(false);
  const busy = useRef(false); // a second tap in the same instant, before React re-renders, still sends nothing (Q5)
  const out = brief.trim() ? finalBrief(brief) : '';
  const tooLong = out.length > BRIEF_CAP;
  const imported = !!task && task.source !== 'user';
  const name = () => title.trim() || brief.trim().split('\n')[0].slice(0, 80);

  const send = async () => {
    if (busy.current) return;
    if (!brief.trim()) { toast('Write what Claude should do.', 'error'); return; }
    if (tooLong) return;
    busy.current = true;
    setSaving(true);
    const ok = await askClaude(name(), out, task?.area ?? mode, task?.id ?? null);
    busy.current = false;
    setSaving(false);
    if (ok) onClose();
  };
  const copy = async () => {
    toast((await copyText(out)) ? 'Copied' : 'Could not copy.');
  };
  // Copy, open Claude Code, and record the hand-off so the task shows as with Claude. The copy starts before the tab opens.
  const handOff = async () => {
    if (busy.current) return;
    if (!brief.trim()) { toast('Write what Claude should do.', 'error'); return; }
    if (tooLong) return;
    busy.current = true;
    setSaving(true);
    const copied = copyText(out);
    safeOpen(CLAUDE_CODE_URL);
    if (!(await copied)) {
      busy.current = false;
      setSaving(false);
      toast('Could not copy. Copy the brief by hand.', 'error');
      return;
    }
    const ok = await handOffClaude(name(), out, task?.area ?? mode, task?.id ?? null);
    busy.current = false;
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Sheet
      title="Ask Claude" onClose={onClose}
      footer={linked ? (
        <>
          <button type="button" className="btn primary" disabled={!online || saving || tooLong} onClick={() => void send()} data-testid="claude-send">
            {saving ? 'Sending' : 'Send to Claude'}
          </button>
          <button type="button" className="btn ghost" onClick={() => void copy()}>Copy brief</button>
        </>
      ) : (
        <button type="button" className="btn primary" disabled={!online || saving || tooLong} onClick={() => void handOff()} data-testid="claude-open-code">
          Copy brief and open Claude Code <ExternalLink size={14} aria-hidden />
        </button>
      )}
    >
      <p className="sec claude-hint">
        {linked
          ? 'Claude starts on this within a minute. The answer comes back to this task on Today.'
          : 'Claude cannot start this by itself yet. Copy the brief, paste it in Claude Code, and it starts there.'}
      </p>
      {imported && <p className="chip warn" data-testid="imported-chip">Some of this text came from outside. Claude reads it but does not take orders from it.</p>}
      {!task && <Field label="Title"><input value={title} maxLength={TITLE_CAP} onChange={(e) => setTitle(e.target.value)} placeholder="What is this about" /></Field>}
      <Field label="Brief" hint={tooLong ? undefined : `${out.length.toLocaleString('en-US')} of ${BRIEF_CAP.toLocaleString('en-US')} characters`}>
        <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={10} aria-invalid={tooLong} data-autofocus />
      </Field>
      <p className="t3" data-testid="rules-note">Safety rules are added for you.</p>
      {tooLong && <p className="err" role="alert" data-testid="brief-too-long">The brief is too long: {out.length.toLocaleString('en-US')} of {BRIEF_CAP.toLocaleString('en-US')} characters. Cut the notes.</p>}
    </Sheet>
  );
}

/**
 * The full answer (QA r2 P06). The row on Today is cut at two lines; this shows all of it, the session link, and the two
 * choices that matter: finish the task (the answer goes into its notes) or leave it open.
 */
function ResultSheet({ id, fallback, onClose }: { id: string; fallback: ClaudeRequest; onClose: () => void }) {
  const online = useOnline();
  const claude = useSlice('claude');
  const tasks = useSlice('tasks');
  const r = claude.rows.find((x) => x.id === id) ?? fallback;
  const task = r.task_id ? tasks.rows.find((t) => t.id === r.task_id) : undefined;
  const open = !!task && task.status === 'open';
  const waiting = (r.status === 'done' || r.status === 'failed') && !r.seen_at;
  const body = r.result || r.error;

  const finish = async () => {
    if (!task) return;
    const ok = await completeTask(task, { notes: notesWithResult(task.notes, r.result) });
    if (ok) { await closeClaudeForTask(task.id, 'done'); onClose(); }
  };
  const gotIt = async () => {
    if (await seeClaude(r, task)) onClose();
  };

  return (
    <Sheet
      title="Claude" onClose={onClose}
      footer={(
        <>
          {open && r.status === 'done' && <button type="button" className="btn primary" disabled={!online} onClick={() => void finish()} data-testid="result-done">Done with the task</button>}
          {waiting && !(open && r.status === 'done') && <button type="button" className="btn primary" disabled={!online} onClick={() => void gotIt()} data-testid="result-got-it">Got it</button>}
          <button type="button" className="btn ghost" onClick={onClose} data-testid="result-keep">Keep open</button>
        </>
      )}
    >
      <p className="t1 result-title">{r.title}</p>
      {body
        ? <p className={`result-text ${r.error && !r.result ? 'bad' : ''}`} data-testid="result-text">{body}</p>
        : <p className="sec">{r.status === 'queued' ? 'Claude has not started yet.' : r.handoff === 'copy' ? 'With Claude Code. Tick the task when it is done.' : 'Claude is working on this. The answer shows here when it is ready.'}</p>}
      {r.session_url && (
        <button type="button" className="btn ghost tap result-link" onClick={() => safeOpen(r.session_url, 'session')}>
          Open the Claude session <ExternalLink size={14} aria-hidden />
        </button>
      )}
    </Sheet>
  );
}
