import { useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { useThemePref } from '../components/Theme';
import { Field, Segmented } from '../components/ui';
import { settingValue, setSetting } from '../lib/actions';
import { useAuth } from '../lib/auth';
import { chooseSampleData, getClient, selectedKind, ALL_TABLES } from '../lib/data';
import type { Row, TableName } from '../lib/data';
import { DEFAULT_FX, type Fx } from '../lib/logic/finance';
import { dayMonth, vendorLabel } from '../lib/logic/format';
import { useOnline } from '../lib/online';
import { dropOtherDevices, enablePush, removeDevice } from '../lib/push';
import { permission } from '../lib/reminders';
import { useSlice } from '../lib/store';
import { toast } from '../lib/toast';
import { istDate, istTime } from '../shared/ist';
import type { Balance, Mode } from '../lib/types';

/** The order each table is read in for the export, so a page boundary never repeats or skips a row. */
const EXPORT_ORDER: Partial<Record<TableName, string[]>> = {
  os_days: ['day'], os_settings: ['key'], os_habit_logs: ['day', 'habit_id'], os_sms_days: ['day', 'account'],
};
const EXPORT_PAGE = 1000;

const LINKS: [string, string][] = [
  ['Claude Code', 'https://claude.ai/code'],
  ['Claude Code schedules', 'https://claude.ai/code/routines'],
  ['WorkOS on GitHub', 'https://github.com/Deztrox1/WorkOS'],
  ['cold-outreach on GitHub', 'https://github.com/Deztrox1/cold-outreach'],
];
const VENDOR_URL: Record<string, string> = {
  consulti: 'https://consulti.ai', millionverifier: 'https://app.millionverifier.com', numlookup: 'https://www.numlookupapi.com',
  anymailfinder: 'https://anymailfinder.com', instantly: 'https://app.instantly.ai', winnr: 'https://winnr.io',
};
const ROUTINE_HOWTO = 'https://github.com/Deztrox1/WorkOS/blob/main/infra/README.md';
const fmt = (n: number) => n.toLocaleString('en-US');
const stamp = (iso: string | null | undefined) => {
  if (!iso) return 'never';
  const ms = new Date(iso).getTime();
  return `${dayMonth(istDate(ms))} ${istTime(ms)}`;
};

export function Settings() {
  const { user, signOut } = useAuth();
  const online = useOnline();
  const settings = useSlice('settings');
  const subs = useSlice('push_subs');
  const campaigns = useSlice('campaigns');
  const kind = selectedKind();
  const now = Date.now();

  const sv = <T,>(k: string, d: T) => { void settings.rows; return settingValue<T>(k, d); };
  const fx: Fx = { ...DEFAULT_FX, ...sv<Fx>('fx', DEFAULT_FX) };
  const [inr, setInr] = useState(String(Math.round(1 / (fx.INR || 1 / 84))));
  const [gbp, setGbp] = useState(String(fx.GBP));
  const [pw, setPw] = useState('');
  const [label, setLabel] = useState('');
  const [perm, setPerm] = useState(permission());
  const [theme, setTheme] = useThemePref();
  const [renewEdit, setRenewEdit] = useState<Record<string, string>>({});

  const balances = sv<Record<string, Balance>>('balances', {});
  const limits = sv<Record<string, number>>('balance_limits', {});
  const renewals = sv<Record<string, string>>('balance_renewals', {});
  const defaultMode = sv<Mode>('default_mode', 'work');
  const heartbeat = sv<{ updated_at?: string } | null>('heartbeat_state', null);
  const pushRun = sv<string | { at?: string } | null>('push_last_run', null);
  const routine = sv<{ linked?: boolean; last_fired_at?: string } | null>('claude_routine', null);
  const calendar = useSlice('calendar_state').rows[0];
  const lastCollector = useMemo(() => (campaigns.rows.length ? Math.max(...campaigns.rows.map((c) => new Date(c.taken_at).getTime())) : null), [campaigns.rows]);
  const pushAt = typeof pushRun === 'string' ? pushRun : pushRun?.at ?? null;
  const pushLate = pushAt ? now - new Date(pushAt).getTime() > 5 * 60_000 : false;
  const beatAt = heartbeat?.updated_at ? new Date(heartbeat.updated_at).getTime() : null;
  // System health shows a problem first and folds away when all is fine (QA r1 U14). Nothing run yet is not "all fine" (QA r2 C16).
  const nothingRan = lastCollector === null && beatAt === null && pushAt === null;
  const problems: [string, string][] = [];
  if (pushLate) problems.push(['push-late', 'Reminders may come late. The sender has not run for 5 minutes.']);
  if (beatAt !== null && now - beatAt > 26 * 3600_000) problems.push(['heartbeat-late', 'The daily check has not run for a day']);
  if (lastCollector !== null && now - lastCollector > 3 * 3600_000) problems.push(['collector-late', 'Campaign numbers are over 3 hours old']);

  const saveFx = async () => {
    const n = Number(inr), g = Number(gbp);
    if (!(n > 0) || !(g > 0)) { toast('Rates must be above 0.', 'error'); return; }
    await setSetting('fx', { USD: 1, INR: 1 / n, GBP: g }, { ok: 'Saved' });
  };
  const changePw = async () => {
    try {
      await getClient().auth.updatePassword(pw);
      setPw('');
      // Other devices stop getting notifications, so a stolen session cannot keep listening (QA r2 S10).
      const gone = await dropOtherDevices();
      toast(gone > 0 ? 'Password changed. Notifications on your other devices are off.' : 'Password changed');
    } catch {
      toast('Could not change the password. Try a longer one.', 'error');
    }
  };
  const enable = async () => {
    const r = await enablePush(label.trim() || 'This device');
    setPerm(permission());
    if (r === 'denied') toast('Notifications are blocked in the browser.', 'error');
    if (r === 'unsupported') toast('This browser cannot do notifications.', 'error');
  };
  const saveRenewal = async (vendor: string) => {
    const v = (renewEdit[vendor] ?? '').trim();
    await setSetting('balance_renewals', { ...renewals, [vendor]: v }, { ok: 'Saved' });
  };
  // Every table is read in pages, so the API row cap cannot cut an export without a word (QA r1 Q20).
  const readAll = async (t: TableName): Promise<Row[]> => {
    const order = (EXPORT_ORDER[t] ?? ['id']).map((c) => [c, 'asc'] as [string, 'asc']);
    const out: Row[] = [];
    for (let p = 0; p < 200; p++) {
      const page = await getClient().select(t, { order, range: [p * EXPORT_PAGE, (p + 1) * EXPORT_PAGE - 1] });
      out.push(...page);
      if (page.length < EXPORT_PAGE) break;
    }
    return out;
  };
  const exportAll = async () => {
    // Push subscriptions hold device keys and never leave the account (security audit 2026-10-27).
    const out: Record<string, unknown> = {};
    try {
      for (const t of ALL_TABLES) if (t !== 'os_push_subscriptions') out[t] = await readAll(t);
    } catch {
      toast('Could not export. Nothing was saved. Try again.', 'error');
      return;
    }
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'workos-export.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const goLive = () => { try { localStorage.removeItem('workos.data'); } catch { /* ignore */ } location.href = location.pathname + '?mock=0#/settings'; location.reload(); };
  const goMock = () => { chooseSampleData(); location.reload(); };
  const sec = (id: string, title: string) => <div className="sec-h"><h2 id={id}>{title}</h2></div>;

  return (
    <div className="sheetpaper page settings-page">
      <div className="page-h"><h1>Settings</h1></div>

      <section className="sheet-sec" aria-labelledby="s-look">
        {sec('s-look', 'Look')}
        <div className="field"><span className="lbl">Theme</span>
          <Segmented label="Theme" value={theme} onChange={setTheme} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} paper />
          <span className="hint">The switch at the top flips light and dark. System follows your phone.</span>
        </div>
        <div className="field"><span className="lbl">Mode on first open</span>
          <Segmented label="Default mode" value={defaultMode} onChange={(m) => void setSetting('default_mode', m, { ok: 'Saved' })} options={[{ value: 'personal', label: 'Personal' }, { value: 'work', label: 'Work' }]} paper />
        </div>
      </section>

      <section className="sheet-sec" aria-labelledby="s-not">
        {sec('s-not', 'Notifications')}
        <p data-testid="notif-status">{subs.rows.length > 0 ? `On, ${subs.rows.length} device${subs.rows.length === 1 ? '' : 's'}` : 'Off on every device'}</p>
        {perm === 'denied' && <p className="hint">Allow notifications for this site in the browser settings, then tap Enable again.</p>}
        <div className="set-line">
          <Field label="This device"><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Pixel, laptop" /></Field>
          <button type="button" className="btn primary" disabled={!online} onClick={() => void enable()}>Enable on this device</button>
        </div>
        <ul className="list">
          {subs.rows.map((s) => (
            <li key={s.endpoint} className="row" data-testid="device-row">
              <span className="main-btn"><span className="t1">{s.device_label || 'Device'}</span><span className="t3">added {stamp(s.created_at)}</span></span>
              <button type="button" className="btn sm" disabled={!online} aria-label={`Remove ${s.device_label || 'device'}`} onClick={() => void removeDevice(s.endpoint)}>Remove</button>
            </li>
          ))}
        </ul>
      </section>

      <section className="sheet-sec" aria-labelledby="s-bal">
        {sec('s-bal', 'Balances')}
        <p className="hint" style={{ marginBottom: 8 }}>Checked daily. Type a renewal date once and it stays.</p>
        {Object.keys(balances).length === 0 ? <p className="empty">No balances yet.</p> : (
          <ul className="list">
            {Object.entries(balances).map(([vendor, b]) => {
              const limit = b.limit ?? limits[vendor] ?? null;
              const low = limit !== null && b.value !== null && b.value < limit * 0.1;
              const renew = renewals[vendor] ?? '';
              return (
                <li key={vendor} className="row" data-testid={`bal-${vendor}`} data-low={low} style={{ alignItems: 'center' }}>
                  <span className="main-btn">
                    <span className="t1">{VENDOR_URL[vendor] ? <a className="tap vendor-link" href={VENDOR_URL[vendor]} target="_blank" rel="noreferrer">{vendorLabel(vendor)} <ExternalLink size={12} aria-hidden /></a> : vendorLabel(vendor)}{low && <b className="bad"> low</b>}</span>
                    <span className="t3"><span className={low ? 'bad' : ''}>{b.value === null ? '-' : fmt(b.value)}</span>{limit === null ? ' left' : ` of ${fmt(limit)}`} · checked {stamp(b.taken_at)}{renew ? ` · renews ${renew}` : ''}</span>
                  </span>
                  <span className="side" style={{ gap: 6 }}>
                    <input className="input" type="date" aria-label={`${vendorLabel(vendor)} renews on`} style={{ width: 150 }} value={renewEdit[vendor] ?? renew} onChange={(e) => setRenewEdit({ ...renewEdit, [vendor]: e.target.value })} onBlur={() => { if (renewEdit[vendor] !== undefined && renewEdit[vendor] !== renew) void saveRenewal(vendor); }} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="sheet-sec" aria-labelledby="s-money">
        {sec('s-money', 'Money')}
        <div className="set-line">
          <Field label="1 USD in INR"><input type="number" min="1" value={inr} onChange={(e) => setInr(e.target.value)} style={{ width: 120 }} /></Field>
          <Field label="1 GBP in USD"><input type="number" min="0" step="0.01" value={gbp} onChange={(e) => setGbp(e.target.value)} style={{ width: 120 }} /></Field>
          <button type="button" className="btn" disabled={!online} onClick={() => void saveFx()}>Save rates</button>
        </div>
      </section>

      <section className="sheet-sec" aria-labelledby="s-calendar">
        {sec('s-calendar', 'Google Calendar')}
        <dl className="kv">
          <dt>Linked</dt><dd data-testid="calendar-linked">{calendar?.linked ? 'yes' : 'not yet'}</dd>
          <dt>Last checked</dt><dd>{calendar?.last_ok_at ? stamp(calendar.last_ok_at) : 'never'}</dd>
        </dl>
        <p className="hint" style={{ marginTop: 8 }}>{calendar?.problem ?? (calendar?.linked ? 'A task with a date and a time goes on your calendar. What is on your calendar shows on Today.' : 'Once linked, a task with a date and a time goes on your calendar, and your calendar shows on Today.')}</p>
        {!calendar?.linked && <p className="hint" style={{ marginTop: 4 }} data-testid="calendar-howto">Ask Claude to link it from the Mac, then press Allow.</p>}
      </section>

      <section className="sheet-sec" aria-labelledby="s-claude">
        {sec('s-claude', 'Claude Code')}
        <dl className="kv">
          <dt>Starts by itself</dt><dd data-testid="routine-link">{routine?.linked ? 'yes' : 'not yet'}</dd>
          <dt>Last started</dt><dd>{routine?.last_fired_at ? stamp(routine.last_fired_at) : 'never'}</dd>
        </dl>
        <p className="hint" style={{ marginTop: 8 }}>{routine?.linked ? 'Ask Claude on any task and it starts within a minute.' : <a className="tap" href={ROUTINE_HOWTO} target="_blank" rel="noreferrer">How to set this up <ExternalLink size={12} aria-hidden /></a>}</p>
      </section>

      <section className="sheet-sec" aria-labelledby="s-links">
        {sec('s-links', 'Links')}
        <ul className="list links" data-testid="links">
          {LINKS.map(([t, h]) => <li key={t}><a className="tap" href={h} target="_blank" rel="noreferrer">{t} <ExternalLink size={12} aria-hidden /></a></li>)}
        </ul>
      </section>

      <section className="sheet-sec" aria-labelledby="s-acc">
        {sec('s-acc', 'Account')}
        <p data-testid="account-email">{user?.email}</p>
        <Field label="New password (12 characters or more)"><input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <div className="set-line">
          <button type="button" className="btn" disabled={!online || pw.length < 12} onClick={() => void changePw()}>Change password</button>
          <button type="button" className="btn" onClick={() => void signOut()}>Sign out</button>
        </div>
      </section>

      <section className="sheet-sec" aria-labelledby="s-sys">
        {sec('s-sys', 'System')}
        {problems.length > 0
          ? <ul className="list health" data-testid="sys-problems">{problems.map(([id, text]) => <li key={id} className="row"><b className="bad" data-testid={id}>{text}</b></li>)}</ul>
          : nothingRan
            ? <p data-testid="sys-none">No checks have run yet.</p>
            : <p data-testid="sys-ok">All fine. Reminders and campaign numbers are up to date.</p>}
        <p data-testid="data-mode" style={{ marginTop: 8 }}>{kind === 'mock' ? 'Sample data in this browser' : 'Live'}</p>
        <details className="sys-details" open={problems.length > 0} data-testid="sys-details">
          <summary className="tap">Details</summary>
          <dl className="kv">
            <dt>App version</dt><dd data-testid="app-version">{__APP_VERSION__}</dd>
            <dt>Timezone</dt><dd>Asia/Kolkata</dd>
            <dt>Campaign numbers checked</dt><dd data-testid="last-collector">{lastCollector ? istTime(lastCollector) : 'never'}</dd>
            <dt>Daily check ran</dt><dd data-testid="last-heartbeat">{beatAt ? istTime(beatAt) : 'never'}</dd>
            <dt>Reminder sender</dt><dd>{pushAt ? (pushLate ? 'not running' : 'running') : 'never'}</dd>
          </dl>
        </details>
        <div className="set-line" style={{ marginTop: 12 }}>
          {kind === 'mock' ? <button type="button" className="btn primary" onClick={goLive}>Use live data</button> : <button type="button" className="btn" onClick={goMock}>Use sample data</button>}
          <button type="button" className="btn" onClick={() => void exportAll()}>Export my data</button>
        </div>
      </section>
    </div>
  );
}
