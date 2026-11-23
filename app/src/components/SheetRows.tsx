import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Sparkles } from 'lucide-react';
import { useClaudeSheet } from './ClaudeSheet';
import { markRead, setSetting } from '../lib/actions';
import { safeOpen, withRule } from '../lib/claude';
import { seeClaude, stopWaiting } from '../lib/claudeActions';
import { relTime } from '../lib/logic/format';
import { claudeState, claudeText, type SheetAlert, type SheetFlag, type Spine } from '../lib/logic/today';
import { useMode } from '../lib/mode';
import { useOnline } from '../lib/online';
import { inFlight, type ClaudeRequest, type Task } from '../lib/types';

/** What a screen reader hears on every row (QA r2 C42). The eye gets a 6 px tinted rule at every width (R4U22). */
const HEARD = { now: 'Needs a look', today: 'Today', plan: 'Due today', older: 'Older', claude: 'With Claude' } as const;
export type BandKey = keyof typeof HEARD;

/** One ruled sheet row: band | time spine | body | side. A row with nothing for the spine drops the column (R4U22). */
export function Row({ band, spine, cls = '', testid = 'sheet-row', data = {}, children, side }: {
  band: BandKey; showWord?: boolean; spine: Spine; cls?: string; testid?: string; data?: Record<string, string | boolean>;
  children: ReactNode; side?: ReactNode;
}) {
  const attrs = Object.fromEntries(Object.entries(data).map(([k, v]) => [`data-${k}`, String(v)]));
  return (
    <li className={`srow ${cls} ${spine ? '' : 'notime'}`} data-testid={testid} data-band={band} {...attrs}>
      <span className={`band ${band}`}><span className="sr">{HEARD[band]}</span></span>
      {spine && (
        <span className={`spine ${spine.tone}`}>
          {spine.sr ? <><span aria-hidden>{spine.text}</span><span className="sr">{spine.sr}</span></> : spine.text}
          {spine.note && <span className="sp-note">{spine.note}</span>}
        </span>
      )}
      <span className="body">{children}</span>
      <span className="side">{side}</span>
    </li>
  );
}

/**
 * What Claude is doing about a row, on the row, until the owner taps Got it (QA r1 decision 2). The line opens the full answer
 * (QA r2 P06). Got it keeps the answer in the task's notes; Stop waiting ends a request that went quiet.
 */
export function ClaudeLine({ req, now, task }: { req: ClaudeRequest; now: number; task?: Task }) {
  const online = useOnline();
  const { openResult } = useClaudeSheet();
  const state = claudeState(req, now);
  const finished = !inFlight(req.status);
  return (
    <span className={`cl-line ${state}`} data-testid="claude-line" data-status={req.status} data-state={state}>
      <Sparkles size={14} aria-hidden />
      <button type="button" className="cl-t ell2" onClick={() => openResult(req)}>{claudeText(req, now)}</button>
      {req.session_url && <button type="button" className="icon-btn acc" aria-label="Open the Claude session" onClick={() => safeOpen(req.session_url, 'session')}><ExternalLink size={16} aria-hidden /></button>}
      {finished && <button type="button" className="btn sm" disabled={!online} aria-label={`Clear ${req.title} from Today`} onClick={() => void seeClaude(req, task)}>Got it</button>}
      {state === 'stuck' && <button type="button" className="btn sm" disabled={!online} aria-label={`Stop waiting for ${req.title}`} onClick={() => void stopWaiting(req)}>Stop waiting</button>}
    </span>
  );
}

/** What Claude is asked about a work exception (QA r2 P09). It prepares; it never pauses, sends or spends. */
const flagBrief = (f: SheetFlag) =>
  // The flag's words come from campaign names and tools, so they ride inside the Context fence, not in the instruction.
  withRule(
    f.id === 'bounce'
      ? 'Look at this bounce flag. Find the bad segment and prepare a pause. Do not pause anything.'
      : 'Look at this flag. Find the cause and suggest the next step. Do not send or spend anything.',
    `${f.title}. ${f.body.replace(' Open Campaigns to check the list.', '')}`,
    false,
  );

/** A work exception row. Hide for today keeps it off until tomorrow (QA r2 P09). */
export function FlagRow({ r, showWord, seen, today }: { r: SheetFlag; showWord: boolean; seen: Record<string, string>; today: string }) {
  const online = useOnline();
  const { askFree } = useClaudeSheet();
  const { setMode } = useMode();
  const hide = () => void setSetting('flags_seen', { ...Object.fromEntries(Object.entries(seen).filter(([, d]) => d === today)), [r.id]: today });
  return (
    <Row band="now" showWord={showWord} spine={null} data={{ kind: 'flag', flag: r.id }}>
      <span className="check" aria-hidden />
      <span className="stack">
        <Link to={r.to} className="main-btn plain" onClick={() => setMode('work')}>
          <span className="t1 ell2">{r.title}</span>
          <span className="t2 ell2">{r.body}</span>
        </Link>
        <span className="close-acts" role="group" aria-label={r.title}>
          <button type="button" className="chip" disabled={!online} aria-label={`Ask Claude about ${r.title}`} onClick={() => askFree(flagBrief(r), r.title)}>Ask Claude</button>
          <button type="button" className="chip" disabled={!online} aria-label={`Hide ${r.title} for today`} onClick={hide}>Hide for today</button>
        </span>
      </span>
    </Row>
  );
}

/** An unread bad alert. Got it clears it; the row opens its link. */
export function AlertRow({ r, showWord, now }: { r: SheetAlert; showWord: boolean; now: number }) {
  const online = useOnline();
  const e = r.event;
  return (
    <Row
      band="now" showWord={showWord} spine={null} data={{ kind: 'alert' }}
      side={<button type="button" className="btn sm" disabled={!online} aria-label={`Clear ${e.title} from Today`} onClick={() => void markRead([e.id])}>Got it</button>}
    >
      <span className="check" aria-hidden />
      <button type="button" className="main-btn" onClick={() => { void markRead([e.id]); safeOpen(e.url); }}>
        <span className="t1 ell2">{e.title}</span>
        {e.body && <span className="t2 ell2">{e.body}</span>}
        <span className="t3">{relTime(e.occurred_at, now)}</span>
      </button>
    </Row>
  );
}
