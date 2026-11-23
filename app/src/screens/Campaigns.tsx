import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, SlidersHorizontal } from 'lucide-react';
import { useIsPhone } from '../components/TaskRow';
import { Chip, ListState, Sheet, Spark } from '../components/ui';
import { useToday } from '../lib/clock';
import {
  bounceText, campaignDelta, delta24, externalLink, isActive, mismatch, normStatus, playbookStatus, sortCampaigns, sparkPoints, statusRank,
} from '../lib/logic/campaigns';
import { addDays, istTime } from '../shared/ist';
import { store, useSlice } from '../lib/store';
import type { Campaign } from '../lib/types';

/** Plain names for the tools' own slugs. Unknown ones fall back to the slug. */
const CHANNEL_NAME: Record<string, string> = { email: 'Email', sms: 'SMS' };
const ACCOUNT_NAME: Record<string, string> = { instantly: 'Instantly', 'ghl-primary': 'GHL main' };
const STATUS_CHIP: Record<string, string> = { active: 'Live', published: 'Published', paused: 'Paused', draft: 'Draft', completed: 'Finished' };
const STATUS_WORD: Record<string, string> = { active: 'live', published: 'live', paused: 'paused', draft: 'draft', completed: 'finished' };
const LABELS: Record<string, Record<string, string>> = { Channel: CHANNEL_NAME, Account: ACCOUNT_NAME, Status: STATUS_CHIP };
/** Any other GHL account is named from its key, so no client name sits in the public file (QA r4 R4S01). */
const accountName = (a: string) => ACCOUNT_NAME[a] ?? (a.startsWith('ghl-') && a.length > 4 ? `GHL ${a[4].toUpperCase()}${a.slice(5)}` : a);
const plural = (n: number | null | undefined, one: string, many: string) => (n === 1 ? one : many);

/** On a phone the shared start of the names in a group is cut (whole words only), so rows can be told apart. */
function sharedPrefix(names: string[]): string {
  if (names.length < 2) return '';
  const words = names.map((n) => n.split(' '));
  let i = 0;
  while (words.every((w) => w.length > i + 1 && w[i] === words[0][i])) i++;
  return i > 0 ? words[0].slice(0, i).join(' ') + ' ' : '';
}

const PLAYBOOK_WORD: Record<string, string> = { active: 'live', paused: 'paused', draft: 'draft', completed: 'finished' };
const REPO = 'https://github.com/Deztrox1/cold-outreach';

/** Numbers in a line, read as "120 sent, 9 replies": the commas are for screen readers, the gap is for the eye. */
function Figs({ items }: { items: [ReactNode, string][] }) {
  return (
    <span className="figs">
      {items.map(([n, label], i) => (
        <span key={label}>{i > 0 && <span className="sr">, </span>}<b>{n}</b>{label}</span>
      ))}
    </span>
  );
}

function Detail({ c, onClose }: { c: Campaign; onClose: () => void }) {
  const snaps = useSlice('snapshots');
  const today = useToday();
  const pb = playbookStatus(c);
  const metrics: { key: 'sent_total' | 'replies_total' | 'positives_total'; label: string; total: number | null }[] = [
    { key: 'sent_total', label: 'Sent', total: c.sent_total },
    { key: 'replies_total', label: 'Replies', total: c.replies_total },
    { key: 'positives_total', label: 'Positives', total: c.channel === 'sms' ? null : c.positives_total },
  ];
  return (
    <Sheet title={c.campaign_name} onClose={onClose}>
      <dl className="ledger" data-testid="detail-totals">
        {([['Sent', c.sent_total], ['Replies', c.replies_total], ['Positives', c.channel === 'sms' ? null : c.positives_total], ['Bounces', c.bounces_total], ['Opens', c.opens_total], ['Leads', c.leads_total]] as const).map(([l, v]) => (
          <div key={l}><dt>{l}</dt><dd className={v === null ? 'mute' : ''}>{v ?? '-'}</dd></div>
        ))}
      </dl>
      <div className="spark-rows" aria-label="Last 14 days">
        {metrics.map((m) => {
          const pts = c.channel === 'sms' && m.key === 'positives_total' ? [] : sparkPoints(snaps.rows, c.account, c.campaign_id, m.key, today);
          return (
            <div key={m.key} data-testid={`spark-${m.key}`}>
              <span className="sec">{m.label}</span>
              {pts.length >= 2 ? <Spark points={pts.map((p) => p.value)} label={`${m.label} last 14 days`} /> : <span className="hint">no data for 14 days</span>}
              <span className="now-v">{m.total ?? '-'}</span>
            </div>
          );
        })}
      </div>
      <dl className="kv" style={{ marginTop: 16 }}>
        <dt>Playbook says</dt><dd data-testid="playbook">{pb ? PLAYBOOK_WORD[normStatus(pb)] ?? pb : 'none'}</dd>
        <dt>Playbook notes</dt><dd><a href={`${REPO}/tree/main/cold-outreach-playbook`} target="_blank" rel="noreferrer">Open the playbook</a></dd>
        <dt>Open in {c.channel === 'email' ? 'Instantly' : 'GoHighLevel'}</dt><dd><a href={externalLink(c)} target="_blank" rel="noreferrer" data-testid="ext-link">Open <ExternalLink size={12} aria-hidden /></a></dd>
        <dt>Checked at</dt><dd className="mono">{istTime(new Date(c.taken_at).getTime())}</dd>
      </dl>
      {/* Request change slot for R5 is reserved and hidden in v1 */}
    </Sheet>
  );
}

type GroupKey = 'live-email' | 'live-sms' | 'paused' | 'draft' | 'completed' | 'other';
const GROUPS: { key: GroupKey; label: string }[] = [
  { key: 'live-email', label: 'Live email' }, { key: 'live-sms', label: 'Live SMS' }, { key: 'paused', label: 'Paused' },
  { key: 'draft', label: 'Draft' }, { key: 'completed', label: 'Finished' }, { key: 'other', label: 'Other' },
];
const RANK_KEY: GroupKey[] = ['live-email', 'paused', 'draft', 'completed', 'other'];
const groupOf = (c: Campaign): GroupKey => {
  const r = statusRank(c.status);
  if (r === 0) return c.channel === 'sms' ? 'live-sms' : 'live-email';
  return RANK_KEY[r] ?? 'other';
};

export function Campaigns() {
  const campaigns = useSlice('campaigns');
  const snaps = useSlice('snapshots');
  const sms = useSlice('sms_days');
  const today = useToday();
  const [fch, setFch] = useState('');
  const [fac, setFac] = useState('');
  const [fst, setFst] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [unfolded, setUnfolded] = useState<Set<GroupKey>>(() => new Set(['live-email', 'live-sms']));
  const phone = useIsPhone();
  const now = Date.now();

  const rows = useMemo(
    () => sortCampaigns(campaigns.rows.filter((c) => (!fch || c.channel === fch) && (!fac || c.account === fac) && (!fst || (c.status ?? '') === fst))),
    [campaigns.rows, fch, fac, fst],
  );
  const filtered = !!(fch || fac || fst);
  const grouped = GROUPS.map((g) => ({ ...g, rows: rows.filter((c) => groupOf(c) === g.key) })).filter((g) => g.rows.length > 0);
  const activeEmail = campaigns.rows.filter((c) => c.channel === 'email' && isActive(c));
  const emailAccounts = [...new Set(campaigns.rows.filter((c) => c.channel === 'email').map((c) => c.account))].sort();
  const base = useSlice('baseline');
  const d = useMemo(() => delta24(campaigns.rows, snaps.rows, now, base.rows), [campaigns.rows, snaps.rows, base.rows, now]);
  const asOf = campaigns.rows.length ? Math.max(...campaigns.rows.map((c) => new Date(c.taken_at).getTime())) : null;
  const yesterday = addDays(today, -1);
  const smsRows = sms.rows.filter((r) => r.day === yesterday);
  const uniq = (k: 'channel' | 'account' | 'status') => [...new Set(campaigns.rows.map((c) => (c[k] ?? '') as string).filter(Boolean))].sort();
  const posFor = (c: Campaign) => (c.channel === 'sms' ? null : c.positives_total);
  const detail = open ? campaigns.rows.find((c) => `${c.account}|${c.campaign_id}` === open) : undefined;
  const nFilters = [fch, fac, fst].filter(Boolean).length;
  const toggle = (k: GroupKey) => setUnfolded((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const chips = (label: string, vals: string[], cur: string, set: (v: string) => void) => (
    <div className="chip-group" role="group" aria-label={label}>
      <span className="chip-label" aria-hidden>{label}</span>
      {vals.map((v) => <button key={v} type="button" className="chip" aria-pressed={cur === v} onClick={() => set(cur === v ? '' : v)}>{LABELS[label]?.[v] ?? v}</button>)}
    </div>
  );

  return (
    <div className="sheetpaper page">
      <div className="page-h"><h1>Campaigns</h1>{asOf && <span className="meta" data-testid="as-of">as of {istTime(asOf)}</span>}</div>
      <ListState slices={[campaigns]} empty={campaigns.rows.length === 0} emptyText="No campaign data yet." onRetry={() => void store.refresh(['campaigns', 'snapshots', 'sms_days'])}>
        <section className="sheet-sec chan" aria-label="Channels">
          <div className="sec-h"><h2>Channels</h2><span className="sec-n">email: last 24 h, SMS: yesterday</span></div>
          <ul className="list">
            <li className="lrow" data-testid="chan-email">
              <span className="spine"><span className="word">Email</span></span>
              <span className="body"><span className="txt">
                <span className="t1">{emailAccounts.map(accountName).join(', ') || 'No account'}</span>
                <Figs items={[
                  [<span data-testid="h-active">{activeEmail.length}</span>, ' live'],
                  [<span data-testid="h-sent">{d.sent === null ? '-' : `${d.sent}`}</span>, ' sent in 24 h'],
                  [<span data-testid="h-replies">{d.replies === null ? '-' : `${d.replies}`}</span>, ' replies in 24 h'],
                ]} />
              </span></span>
              <span className="side">
                {activeEmail.length > 0
                  ? <span className="state ok"><span className="dot good" aria-hidden />Sending</span>
                  : <span className="state warn"><span className="dot warn" aria-hidden />None live</span>}
              </span>
            </li>
            {smsRows.map((r) => (
              <li className="lrow" key={r.account} data-testid={`sms-${r.account}`}>
                <span className="spine"><span className="word">SMS</span></span>
                <span className="body"><span className="txt">
                  <span className="t1">{accountName(r.account)}, <span className="t3">yesterday</span></span>
                  <Figs items={[[r.sent, ' sent'], [r.replies, plural(r.replies, ' reply', ' replies')], [r.positives, plural(r.positives, ' positive', ' positives')], [r.stops, ' said stop']]} />
                </span></span>
                <span className="side">
                  {r.capped
                    ? <span className="state warn"><span className="dot warn" aria-hidden />capped</span>
                    : <span className={`state ${(r.sent ?? 0) > 0 ? 'ok' : 'idle'}`}><span className={`dot ${(r.sent ?? 0) > 0 ? 'good' : 'info'}`} aria-hidden />{(r.sent ?? 0) > 0 ? 'Sent' : 'Quiet'}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {phone ? (
          <div className="camp-filters">
            <button type="button" className="btn sm" onClick={() => setFilterOpen(true)}>
              <SlidersHorizontal size={14} aria-hidden />Filter{nFilters > 0 ? ` (${nFilters})` : ''}
            </button>
          </div>
        ) : (
          <div className="filters camp-filters" data-testid="filters">
            {chips('Channel', uniq('channel'), fch, setFch)}
            {chips('Account', uniq('account'), fac, setFac)}
            {chips('Status', uniq('status'), fst, setFst)}
          </div>
        )}
        <div className="tbl-wrap">
          <table className="tbl camp-tbl" data-testid="camp-table">
            <thead>
              <tr>
                <th>Name</th><th className="wide">Channel</th><th className="wide">Account</th><th>Status</th><th className="wide mm"><span className="sr">Playbook</span></th><th className="num">Sent</th><th className="num">Replies</th>
                <th className="num wide">Positives</th><th className="num">Bounce</th><th className="num wide">Leads</th><th className="wide taken">Checked at</th>
              </tr>
            </thead>
            {grouped.map((g) => {
              // A folded group opens by itself when one of its campaigns disagrees with its playbook: that needs a look.
              const flagged = g.rows.some(mismatch);
              const shown = filtered || flagged || unfolded.has(g.key);
              return (
                <tbody key={g.key} className={shown ? '' : 'closed'} data-testid={`camp-group-${g.key}`}>
                  <tr className={`grp ${g.key.startsWith('live') ? 'live' : ''}`}>
                    <td colSpan={11}>
                      <div className="grp-h">
                        {filtered || flagged ? <span className="grp-name">{g.label}{flagged && !g.key.startsWith('live') ? <span className="sr">, playbook differs</span> : null}</span> : (
                          <button type="button" className="sec-toggle" aria-expanded={shown} onClick={() => toggle(g.key)}>
                            {shown ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}<span className="grp-name">{g.label}</span>
                          </button>
                        )}
                        <span className="grp-n">{g.rows.length}</span>
                      </div>
                    </td>
                  </tr>
                  {shown && g.rows.map((c) => {
                    const delta = campaignDelta(c, snaps.rows, now, base.rows);
                    const cut = phone ? sharedPrefix(g.rows.map((r) => r.campaign_name)) : '';
                    return (
                      <tr key={`${c.account}|${c.campaign_id}`} className={c.channel} data-testid="camp-row" data-status={c.status ?? ''}>
                        <td className="name">
                          <button type="button" className="rowbtn" aria-label={c.campaign_name} onClick={() => setOpen(`${c.account}|${c.campaign_id}`)}><span className="ell2">{cut ? c.campaign_name.slice(cut.length) : c.campaign_name}</span></button>
                        </td>
                        <td className="wide">{CHANNEL_NAME[c.channel] ?? c.channel}</td>
                        <td className="wide">{accountName(c.account)}</td>
                        <td className="status">
                          <span className="st"><span className={`dot ${isActive(c) ? 'good' : 'info'}`} aria-hidden />{STATUS_WORD[c.status ?? ''] ?? c.status}</span>
                          {mismatch(c) && <span className="phone-only"> <Chip tone="warn">playbook differs</Chip></span>}
                        </td>
                        <td className="wide mm">{mismatch(c) && <Chip tone="warn">playbook differs</Chip>}</td>
                        <td className="num">{c.sent_total ?? ''}{delta ? <span className="hint"> +{delta}</span> : null}</td>
                        <td className="num">{c.replies_total ?? ''}</td>
                        <td className="num wide" data-testid="positives">{posFor(c) ?? <span className="soft">-</span>}</td>
                        <td className="num">{bounceText(c.sent_total, c.bounces_total)}</td>
                        <td className="num wide">{c.leads_total ?? ''}</td>
                        <td className="wide taken mono" data-testid="taken-at">{istTime(new Date(c.taken_at).getTime())}</td>
                      </tr>
                    );
                  })}
                </tbody>
              );
            })}
          </table>
        </div>
      </ListState>
      {filterOpen && (
        <Sheet title="Filter" onClose={() => setFilterOpen(false)} footer={<button type="button" className="btn primary" onClick={() => setFilterOpen(false)}>Done</button>}>
          <div className="filters" data-testid="filters">
            {chips('Channel', uniq('channel'), fch, setFch)}
            {chips('Account', uniq('account'), fac, setFac)}
            {chips('Status', uniq('status'), fst, setFst)}
          </div>
        </Sheet>
      )}
      {detail && <Detail c={detail} onClose={() => setOpen(null)} />}
    </div>
  );
}
