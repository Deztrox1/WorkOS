
import { ExternalLink, Sparkles } from 'lucide-react';
import { useClaudeSheet } from '../components/ClaudeSheet';
import { ListState } from '../components/ui';
import { safeOpen } from '../lib/claude';
import { cancelClaude, finishClaude, seeClaude, stopWaiting } from '../lib/claudeActions';
import { dayMonth, relTime } from '../lib/logic/format';
import { claudeState } from '../lib/logic/today';
import { useOnline } from '../lib/online';
import { store, useSlice } from '../lib/store';
import { inFlight, type ClaudeRequest } from '../lib/types';
import { istDate, istTime } from '../shared/ist';

const ROUTINE_HOWTO = 'https://github.com/Deztrox1/WorkOS/blob/main/infra/README.md';
const WORD = { queued: 'not started', working: 'working', stuck: 'no word', done: 'done', failed: 'failed' } as const;

export function ClaudeScreen() {
  const online = useOnline();
  const { askFree, openResult } = useClaudeSheet();
  const claude = useSlice('claude');
  const settings = useSlice('settings');
  const tasks = useSlice('tasks');
  const now = Date.now();
  // Both areas: this screen has no mode switch (call N), so a filter here would hide requests with no way to see them.
  const rows = claude.rows;
  const routine = settings.rows.find((r) => r.key === 'claude_routine')?.value as { linked?: boolean; last_fired_at?: string; error?: string } | undefined;
  const withClaude = rows.filter((r) => inFlight(r.status));
  const finished = rows.filter((r) => !inFlight(r.status));

  const row = (r: ClaudeRequest) => {
    const state = r.status === 'cancelled' ? 'cancelled' : claudeState(r, now);
    const copy = r.handoff === 'copy' && r.status === 'sent' && state !== 'stuck';
    const waiting = (r.status === 'done' || r.status === 'failed') && !r.seen_at;
    const at = new Date(r.created_at).getTime();
    const [d, m] = dayMonth(istDate(at)).split(' ');
    const today = istDate(at) === istDate(now);
    const task = r.task_id ? tasks.rows.find((t) => t.id === r.task_id) : undefined;
    const word = state === 'cancelled' ? 'cancelled' : copy ? 'with Claude Code' : WORD[state];
    return (
      <li key={r.id} className={`lrow ${r.status === 'done' || r.status === 'cancelled' ? 'done' : ''}`} data-testid="claude-item" data-status={r.status} data-unseen={waiting}>
        <span className="spine" aria-hidden>{today ? istTime(at) : <><span>{d}</span><span className="word small">{m}</span></>}</span>
        <span className="body">
          <button type="button" className="main-btn" onClick={() => openResult(r)} aria-label={`Open ${r.title}`}>
            <span className="t1">{r.title}</span>
            {r.result && <span className="t2 ell2">{r.result}</span>}
            {r.error && <span className="t2 bad ell2">{r.error}</span>}
            {copy && <span className="t2">With Claude Code since {istTime(new Date(r.sent_at ?? r.created_at).getTime())}. Tick the task when done.</span>}
            <span className="t3"><span className={`status-word ${r.status}`}>{word}</span> · {relTime(r.created_at, now)}</span>
          </button>
        </span>
        <span className="side">
          {r.session_url && <button type="button" className="icon-btn acc" aria-label="Open the Claude session" onClick={() => safeOpen(r.session_url, 'session')}><ExternalLink size={16} aria-hidden /></button>}
          {waiting && <button type="button" className="btn sm" disabled={!online} aria-label={`Clear ${r.title} from Today`} onClick={() => void seeClaude(r, task)}>Got it</button>}
          {r.status === 'sent' && <button type="button" className="btn sm" disabled={!online} onClick={() => void finishClaude(r)}>Done</button>}
          {r.status === 'sent' && state === 'stuck' && <button type="button" className="btn sm" disabled={!online} onClick={() => void stopWaiting(r)}>Stop waiting</button>}
          {r.status === 'queued' && <button type="button" className="btn sm" disabled={!online} onClick={() => void cancelClaude(r)}>Cancel</button>}
        </span>
      </li>
    );
  };

  return (
    <div className="sheetpaper page claude-page">
      <div className="page-h">
        <h1>Claude</h1>
        <button type="button" className="btn ghost" onClick={() => askFree()}><Sparkles size={16} aria-hidden />Ask Claude</button>
      </div>
      <p className="sec claude-state" data-testid="claude-state">
        {routine?.linked
          ? <>Claude starts these by itself. Last started {routine.last_fired_at ? relTime(routine.last_fired_at, now) : 'never'}. {routine.error ? <span className="bad">The last start failed: {routine.error}</span> : null}</>
          : <>Claude does not start these by itself yet. Open each one in Claude Code to start it. <a className="tap" href={ROUTINE_HOWTO} target="_blank" rel="noreferrer">How to set it up <ExternalLink size={12} aria-hidden /></a></>}
      </p>
      <ListState slices={[claude]} empty={rows.length === 0} emptyText="No requests yet. Press Ask Claude on any task." onRetry={() => void store.refresh(['claude'])}>
        {withClaude.length > 0 && (
          <section className="sheet-sec" aria-label="With Claude">
            <div className="sec-h"><h2>With Claude</h2><span className="sec-n">{withClaude.length}</span></div>
            <ul className="list">{withClaude.map(row)}</ul>
          </section>
        )}
        {finished.length > 0 && (
          <section className="sheet-sec" aria-label="Finished">
            <div className="sec-h"><h2>Finished</h2><span className="sec-n">{finished.length}</span></div>
            <ul className="list">{finished.map(row)}</ul>
          </section>
        )}
      </ListState>
    </div>
  );
}
