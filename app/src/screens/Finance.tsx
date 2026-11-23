import { useMemo, useState, type ReactNode } from 'react';
import { Plus, Repeat } from 'lucide-react';
import { FinanceChart } from './FinanceChart';
import { Chip, Confirm, Field, ListState, Sheet } from '../components/ui';
import { deleteEntry, saveEntry, settingValue } from '../lib/actions';
import { useToday } from '../lib/clock';
import { DEFAULT_FX, cents, counted, entriesFor, isDraft, summarize, totalUsd, twelveMonths, type Fx } from '../lib/logic/finance';
import { monthLabel, usd } from '../lib/logic/format';
import { useOnline } from '../lib/online';
import { store, useSlice } from '../lib/store';
import type { FinanceEntry } from '../lib/types';
import { addMonths, startOfMonth } from '../shared/ist';

function EntrySheet({ entry, kind, month, onClose }: { entry?: FinanceEntry; kind: 'cost' | 'revenue'; month: string; onClose: () => void }) {
  const online = useOnline();
  const [label, setLabel] = useState(entry?.label ?? '');
  const [amount, setAmount] = useState(entry ? String(entry.amount) : '');
  const [currency, setCurrency] = useState(entry?.currency ?? 'USD');
  const [rec, setRec] = useState<'monthly' | 'one_time'>(entry?.recurrence ?? 'one_time');
  const [start, setStart] = useState((entry?.month ?? month).slice(0, 7));
  const [end, setEnd] = useState(entry?.end_month?.slice(0, 7) ?? '');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const save = async () => {
    const n = Number(amount);
    if (!label.trim() || !(n >= 0) || amount === '') { setError('Add a label and an amount.'); return; }
    if (kind === 'cost' && rec === 'monthly' && end && end < start) { setError('The end month cannot be before the start month.'); return; }
    const ok = await saveEntry(
      { ...(entry ? { id: entry.id } : {}), label: label.trim(), amount: n, currency, recurrence: kind === 'cost' ? rec : 'one_time', month: `${start}-01`, end_month: kind === 'cost' && rec === 'monthly' && end ? `${end}-01` : null },
      kind, month,
    );
    if (ok) onClose();
  };
  return (
    <>
      <Sheet
        title={`${entry ? 'Edit' : 'Add'} ${kind}`} onClose={onClose}
        footer={<>
          <button type="button" className="btn primary" disabled={!online} onClick={() => void save()}>Save</button>
          {entry && <button type="button" className="btn danger" disabled={!online} onClick={() => setConfirm(true)}>Delete</button>}
        </>}
      >
        <Field label="Label"><input value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
        <Field label="Amount"><input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Currency"><select value={currency} onChange={(e) => setCurrency(e.target.value)}><option>USD</option><option>INR</option><option>GBP</option></select></Field>
        {kind === 'cost' && (
          <Field label="Repeats"><select value={rec} onChange={(e) => setRec(e.target.value as 'monthly' | 'one_time')}><option value="one_time">One time</option><option value="monthly">Every month</option></select></Field>
        )}
        <Field label={rec === 'monthly' && kind === 'cost' ? 'Start month' : 'Month'}><input type="month" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        {kind === 'cost' && rec === 'monthly' && <Field label="End month" hint="Leave empty to keep going."><input type="month" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>}
        {error && <p className="err" role="alert">{error}</p>}
      </Sheet>
      {confirm && entry && <Confirm text="Delete this entry?" onCancel={() => setConfirm(false)} onConfirm={async () => { setConfirm(false); await deleteEntry(entry.id); onClose(); }} />}
    </>
  );
}

export function Finance() {
  const today = useToday();
  const online = useOnline();
  const fin = useSlice('finance');
  const settings = useSlice('settings');
  const [month, setMonth] = useState(startOfMonth(today));
  const [edit, setEdit] = useState<{ entry?: FinanceEntry; kind: 'cost' | 'revenue' } | null>(null);
  const fx: Fx = useMemo(() => ({ ...DEFAULT_FX, ...settingValue<Fx>('fx', DEFAULT_FX) }), [settings.rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const target = useMemo(() => Number(settingValue<number>('profit_target', 1000)), [settings.rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const costs = entriesFor(fin.rows, month, 'cost');
  const revenue = entriesFor(fin.rows, month, 'revenue');
  const sum = summarize(fin.rows, month, fx);
  const chart = useMemo(() => twelveMonths(fin.rows, month, fx), [fin.rows, month, fx]);
  const months = Array.from({ length: 28 }, (_, i) => addMonths(startOfMonth(today), 3 - i));
  const on = cents(sum.profit) >= target;
  const empty = chart.every((m) => m.revenue === 0 && m.costs === 0);

  const line = (e: FinanceEntry) => {
    const ledger = e.source === 'ledger';
    const draft = isDraft(e);
    const meta = [e.recurrence === 'monthly' ? 'every month' : 'one time', ledger ? (draft ? 'draft, not sent yet' : `status ${e.notes ?? 'sent'}`) : null].filter(Boolean).join(' · ');
    const body = (
      <>
        <span className="t1">{e.kind === 'revenue' && ledger ? `${e.source_ref} · ${e.label}` : e.label}{ledger && <> <Chip>invoice</Chip></>}</span>
        <span className="t3">{meta}</span>
      </>
    );
    return (
      <li key={e.id} className={`lrow ${draft ? 'read' : ''}`} data-testid={`fin-row-${e.kind}`} data-draft={draft}>
        <span className="spine soft" aria-hidden>{e.recurrence === 'monthly' && <Repeat size={14} />}</span>
        <span className="body">
          {ledger ? <span className="main-btn">{body}</span> : (
            <button type="button" className="main-btn" onClick={() => setEdit({ entry: e, kind: e.kind })} aria-label={`Edit ${e.label}`}>{body}</button>
          )}
        </span>
        <span className="side">
          <span className="amt">{Number(e.amount).toLocaleString('en-US')} <small>{e.currency}</small></span>
          {ledger && !draft && e.notes !== 'paid' && (
            <button type="button" className="btn sm" disabled={!online} onClick={() => void saveEntry({ id: e.id, label: e.label, amount: Number(e.amount), notes: 'paid' }, 'revenue', month)}>Mark paid</button>
          )}
        </span>
      </li>
    );
  };

  const section = (kind: 'cost' | 'revenue', rows: FinanceEntry[], title: string, addLabel: string, foot?: ReactNode) => (
    <section className="sheet-sec" aria-label={title}>
      <div className="sec-h">
        <h2>{title}</h2>
        <button type="button" className="btn ghost sm add" disabled={!online} onClick={() => setEdit({ kind })}><Plus size={14} aria-hidden />{addLabel}</button>
      </div>
      {rows.length === 0 ? <p className="empty">Nothing recorded.</p> : <ul className="list">{rows.map(line)}</ul>}
      {foot}
    </section>
  );

  return (
    <div className="sheetpaper page">
      <div className="page-h">
        <h1>Finance</h1>
        <select aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)}>
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
      </div>
      <ListState slices={[fin]} empty={false} emptyText="" onRetry={() => void store.refresh(['finance', 'settings'])}>
        <dl className="ledger" aria-label={`Totals for ${monthLabel(month)}`} style={{ marginTop: 16 }}>
          <div><dt>Revenue</dt><dd data-testid="fin-revenue">{usd(cents(sum.revenue))}</dd></div>
          <div><dt>Costs</dt><dd data-testid="fin-costs">{usd(cents(sum.costs))}</dd></div>
          <div>
            <dt>Profit</dt>
            <dd className={on ? 'good' : 'bad'} data-testid="fin-profit">{usd(cents(sum.profit))}</dd>
            <dd className="sub"><span className={on ? 'good' : 'bad'} data-testid="fin-status">{on ? 'on target' : 'under target'}</span> <span className="mute">of {usd(target)}</span></dd>
          </div>
        </dl>

        {section('cost', costs, 'Costs', 'Add cost')}
        {section('revenue', revenue, 'Revenue', 'Add revenue', <p className="total-line"><span>Revenue, all currencies</span><b data-testid="fin-usd-total">USD total {usd(cents(totalUsd(counted(revenue), fx)))}{revenue.some(isDraft) ? '. Drafts do not count until sent.' : ''}</b></p>)}
        <section className="sheet-sec" aria-label="12 months">
          <div className="sec-h"><h2>12 months</h2><span className="sec-n">USD</span></div>
          {empty ? <p className="empty">Nothing recorded.</p> : <FinanceChart data={chart} target={target} />}
          <p className="hint" style={{ marginTop: 8 }}>Teal bars are revenue, grey bars are costs, the line is profit, the dashed line is the target. Tap a month for the numbers.</p>
        </section>
      </ListState>
      {edit && <EntrySheet key={edit.entry?.id ?? edit.kind} entry={edit.entry} kind={edit.kind} month={month} onClose={() => setEdit(null)} />}
    </div>
  );
}
