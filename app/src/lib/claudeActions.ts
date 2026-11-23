import { getClient, isDuplicate, isRuleError } from './data';
import type { Row } from './data';
import { insertRow, isOnline, patchRow } from './actions';
import { nowMs, store } from './store';
import { toast } from './toast';
import type { Area, ClaudeRequest, Task } from './types';
import { TITLE_CAP, notesWithResult } from './claude';

// Everything the app does to a Claude request. One writer for the table, so the status rules live in one place
// (migration 0008): Cancel only moves a queued request, Done and Stop waiting only a sent one, and a finished request
// changes only its seen_at. A write names the status the screen showed, so it can never undo what the sender did meanwhile.

const nowIso = () => new Date(nowMs()).toISOString();
const uuid = () => crypto.randomUUID();

const RACE = 'Claude already started this one. See it on Today.';
const UNDONE = 'Not saved. Your change was undone. Try again.';
const OFFLINE = 'You are offline. Changes work again when you are back.';
const HAS_ONE = 'Claude already has this task. See it on Today.';

function newRequest(handoff: ClaudeRequest['handoff'], title: string, brief: string, area: Area, taskId: string | null): Omit<ClaudeRequest, 'created_by'> {
  const copy = handoff === 'copy';
  return {
    id: uuid(), area, task_id: taskId, title: title.trim().slice(0, TITLE_CAP), brief: brief.trim(), handoff,
    status: copy ? 'sent' : 'queued', session_url: null, result: null, error: null, sent_at: copy ? nowIso() : null, finished_at: null,
    attempts: 0, seen_at: null, created_at: nowIso(), updated_at: nowIso(),
  };
}

/**
 * Queue a request for Claude Code. The sender fires the routine; the app only writes the row. `created_by` is left to the
 * database default (auth.uid()), which the sender checks before it fires anything.
 */
export function askClaude(title: string, brief: string, area: Area, taskId: string | null) {
  return insertRow('claude', newRequest('routine', title, brief, area, taskId) as unknown as Row, {
    ok: 'Sent. Claude starts within a minute.', dupText: HAS_ONE,
  });
}

/** The owner copied the brief into Claude Code himself: a row that starts as sent, so the task reads as with Claude (R2P07). */
export function handOffClaude(title: string, brief: string, area: Area, taskId: string | null) {
  return insertRow('claude', newRequest('copy', title, brief, area, taskId) as unknown as Row, {
    ok: 'Copied. Paste it in Claude Code. The task shows as with Claude.', dupText: HAS_ONE,
  });
}

type Guard = Pick<ClaudeRequest, 'id' | 'status'>;
type Opts = { ok?: string; quiet?: boolean };

/**
 * One guarded write: apply on screen, send it matching on `id` AND the status the screen showed. Zero rows changed means the
 * request moved on (the sender got there first): put the screen back, refetch, say so.
 */
async function guarded(g: Guard, patch: Partial<ClaudeRequest>, opts: Opts = {}): Promise<boolean> {
  if (!isOnline()) {
    if (!opts.quiet) toast(OFFLINE, 'error');
    return false;
  }
  const before = store.get('claude').rows;
  store.setRows('claude', (rows) => rows.map((r) => (r.id === g.id && r.status === g.status ? { ...r, ...patch, updated_at: nowIso() } : r)));
  const send = () => getClient().update('os_claude_requests', { id: g.id, status: g.status }, patch as Row);
  try {
    let n: number;
    try {
      n = await send();
    } catch (first) {
      if (isRuleError(first) || isDuplicate(first)) throw first;
      n = await send(); // a lost reply: the retry changes 0 rows if the first landed, and the refetch below sees that
    }
    if (n > 0) {
      if (opts.ok) toast(opts.ok);
      return true;
    }
    await store.refresh(['claude']);
    const now = store.get('claude').rows.find((r) => r.id === g.id);
    const landed = patch.status ? now?.status === patch.status : !!now?.seen_at;
    if (landed) {
      if (opts.ok) toast(opts.ok);
      return true;
    }
    if (!opts.quiet) toast(RACE, 'error');
    return false;
  } catch {
    store.set('claude', { rows: before });
    if (!opts.quiet) toast(UNDONE, 'error');
    return false;
  }
}

const finished = (status: ClaudeRequest['status']) => ({ status, finished_at: nowIso(), seen_at: nowIso() }) as Partial<ClaudeRequest>;

/** Cancel: only a request nobody has started. */
export const cancelClaude = (r: Guard) => guarded({ id: r.id, status: 'queued' }, finished('cancelled'), { ok: 'Cancelled' });
/** Done, by hand: Claude (or the owner in Claude Code) finished it. Only a sent request. */
export const finishClaude = (r: Guard) => guarded({ id: r.id, status: 'sent' }, finished('done'), { ok: 'Done' });
/** Stop waiting: the owner gives up on an answer. The task stays open. */
export const stopWaiting = (r: Guard) => guarded({ id: r.id, status: 'sent' }, finished('cancelled'), { ok: 'Stopped waiting. The task stays open.' });

/**
 * Got it: the result leaves Today. With the task and a result, the result is first copied into the task notes, and if that
 * write fails the request stays, so the answer is not lost.
 */
export async function seeClaude(r: ClaudeRequest, task?: Task | null): Promise<boolean> {
  if (r.status === 'done' && r.result && task) {
    const notes = notesWithResult(task.notes, r.result);
    if (notes !== task.notes && !(await patchRow('tasks', { id: task.id }, { notes }))) return false;
  }
  return guarded({ id: r.id, status: r.status }, { seen_at: nowIso() });
}

/**
 * The task was ticked or dropped: close its request. A queued one is cancelled, a sent one is done, a finished one nobody
 * has seen is marked seen. One the sender is firing right now is left alone. Quiet: closing a task never fails on this.
 */
export async function closeClaudeForTask(taskId: string, _how: 'done' | 'dropped'): Promise<void> {
  const r = store.get('claude').rows.find((x) => x.task_id === taskId && (x.status === 'queued' || x.status === 'sent' || ((x.status === 'done' || x.status === 'failed') && !x.seen_at)));
  if (!r) return;
  if (r.status === 'queued') await guarded({ id: r.id, status: 'queued' }, finished('cancelled'), { quiet: true });
  else if (r.status === 'sent') await guarded({ id: r.id, status: 'sent' }, finished('done'), { quiet: true });
  else await guarded({ id: r.id, status: r.status }, { seen_at: nowIso() }, { quiet: true });
}
