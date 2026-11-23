import { useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Activity, Bell, ClipboardCheck, FileText, Flame, Home, LineChart, ListTodo, MoreHorizontal, RefreshCw, Settings, Sparkles, Wallet, X,
} from 'lucide-react';
import { reminderDone, snoozeReminder } from '../lib/actions';
import { dismissBanner, useBanners, type BannerItem } from '../lib/banners';
import { getClient, selectedKind } from '../lib/data';
import { useMode } from '../lib/mode';
import { useOnline } from '../lib/online';
import { useReminderWatcher } from '../lib/reminders';
import { store, useSlice } from '../lib/store';
import { claudeOnToday, sheetAlerts } from '../lib/logic/today';
import { inFlight, type OsEvent } from '../lib/types';
import { istTime } from '../shared/ist';
import { AddButton, AddProvider } from './AddMenu';
import { Brand } from './Brand';
import { ClaudeSheetProvider } from './ClaudeSheet';
import { NoteSheetProvider } from './NoteSheet';
import { ReminderSheetProvider } from './ReminderSheet';
import { TaskSheetProvider } from './TaskSheet';
import { ThemeToggle } from './Theme';
import { Segmented, Toasts } from './ui';

/** badge: the Activity count. dot: a Claude result is waiting. */
export type Item = { to: string; label: string; icon: typeof Home; badge?: boolean; dot?: boolean; group: 'day' | 'work' | 'keep' | 'system' };
export const ALL: Item[] = [
  { to: '/', label: 'Today', icon: Home, group: 'day' },
  { to: '/plan', label: 'Plan', icon: ClipboardCheck, group: 'day' },
  { to: '/tasks', label: 'Tasks', icon: ListTodo, group: 'day' },
  { to: '/reminders', label: 'Reminders', icon: Bell, group: 'day' },
  { to: '/habits', label: 'Habits', icon: Flame, group: 'day' },
  { to: '/campaigns', label: 'Campaigns', icon: LineChart, group: 'work' },
  { to: '/finance', label: 'Finance', icon: Wallet, group: 'work' },
  { to: '/notes', label: 'Notes', icon: FileText, group: 'keep' },
  { to: '/claude', label: 'Claude', icon: Sparkles, dot: true, group: 'keep' },
  { to: '/activity', label: 'Activity', icon: Activity, badge: true, group: 'system' },
  { to: '/settings', label: 'Settings', icon: Settings, group: 'system' },
];
export const GROUP_LABEL = { day: 'The day', work: 'Work', keep: 'Notes and Claude', system: 'System' };

/** 768 px and up: the rail replaces the top bar and the tab bar, and Add sits at the top of the rail. */
const WIDE = '(min-width: 768px)';
function useWide(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(WIDE);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(WIDE).matches,
  );
}

/** The nav does not follow the mode (call N). Phone tabs are always the same: the day, then More. */
export function tabs(): Item[] {
  const by = (to: string) => ALL.find((i) => i.to === to)!;
  return [...['/', '/plan', '/tasks'].map(by), { to: '/more', label: 'More', icon: MoreHorizontal, badge: true, dot: true, group: 'system' }];
}
export function moreItems(): Item[] {
  const shown = new Set(tabs().map((i) => i.to));
  return ALL.filter((i) => !shown.has(i.to));
}
/** The screens the mode switch filters. It sits at the top of these and nowhere else (call N). */
const FILTERED = ['/tasks', '/reminders', '/notes', '/activity'];

/**
 * The Activity count: bad, unread events in both areas that are not already on Today (QA r1 F14). Warnings and
 * info stay on Activity without a number.
 */
export function useUnread(): number {
  const unread = useSlice('unread');
  return useMemo(() => {
    const onToday = new Set(sheetAlerts(unread.rows).map((e) => e.id));
    return unread.rows.filter((e) => !e.read_at && e.severity === 'bad' && !onToday.has(e.id)).length;
  }, [unread.rows]);
}

/** Finished Claude requests the owner has not seen: the More tab and the Claude rail item show a dot. */
export function useClaudeWaiting(): number {
  const claude = useSlice('claude');
  return useMemo(() => claude.rows.filter((r) => !inFlight(r.status) && claudeOnToday(r)).length, [claude.rows]);
}

/** A reminder banner. A fired one offers Done and In 10 min (QA r1 F09). */
function Banner({ b }: { b: BannerItem }) {
  const reminders = useSlice('reminders');
  const online = useOnline();
  const r = b.reminderId ? reminders.rows.find((x) => x.id === b.reminderId) : undefined;
  const act = (fn: () => Promise<boolean>) => () => { dismissBanner(b.id); void fn(); };
  return (
    <div className="banner" role="status" data-testid={`banner-${b.kind}`}>
      <Bell size={16} aria-hidden />
      <span className="grow">{b.text}</span>
      {b.kind === 'fired' && r && (
        <>
          <button type="button" className="btn sm" disabled={!online} onClick={act(() => reminderDone(r))}>Done</button>
          <button type="button" className="btn sm" disabled={!online} onClick={act(() => snoozeReminder(r))}>In 10 min</button>
        </>
      )}
      <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => dismissBanner(b.id)}><X size={16} aria-hidden /></button>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { mode, setMode } = useMode();
  const online = useOnline();
  const unread = useUnread();
  const waiting = useClaudeWaiting();
  const banners = useBanners();
  const mainRef = useRef<HTMLElement>(null);
  const tasks = useSlice('tasks');
  const loc = useLocation();
  const wide = useWide();
  useReminderWatcher(true);

  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);

  // Freshness: refetch on focus and every 5 minutes (PRD 2)
  useEffect(() => {
    const refetch = () => { if (document.visibilityState === 'visible') void store.refreshAll(); };
    window.addEventListener('focus', refetch);
    document.addEventListener('visibilitychange', refetch);
    const id = setInterval(refetch, 5 * 60_000);
    return () => { window.removeEventListener('focus', refetch); document.removeEventListener('visibilitychange', refetch); clearInterval(id); };
  }, []);

  // Realtime: new events show at once; a snapshot insert refetches the campaigns view; a Claude row refetches the queue
  useEffect(() => {
    const c = getClient();
    const offE = c.subscribe('os_events', (row) => {
      const ev = row as unknown as OsEvent;
      for (const k of ['events', 'unread'] as const) store.setRows(k, (rows) => [ev, ...rows.filter((r) => r.id !== ev.id)]);
    });
    const offS = c.subscribe('os_campaign_snapshots', () => { void store.refresh(['campaigns', 'snapshots']); });
    // Every event: the poller and the routine move a request along with UPDATEs (QA r1 D13).
    const offC = c.subscribe('os_claude_requests', () => { void store.refresh(['claude']); }, '*');
    return () => { offE(); offS(); offC(); };
  }, []);

  const filtered = FILTERED.includes(loc.pathname);
  const modeSwitch = (
    <Segmented
      label="Mode" value={mode} onChange={setMode} paper
      options={[{ value: 'personal', label: 'Personal' }, { value: 'work', label: 'Work' }]}
    />
  );
  const marks = (i: Item) => (
    <>
      {i.badge && unread > 0 && <span className="badge" data-testid="feed-badge" aria-label={`${unread} unread`}>{unread}</span>}
      {i.dot && waiting > 0 && !(i.badge && unread > 0) && <span className="dot-mark" data-testid="claude-dot" role="img" aria-label="A Claude result is waiting" />}
    </>
  );
  const skip = () => mainRef.current?.focus();
  const synced = tasks.syncedAt ? istTime(tasks.syncedAt) : '--:--';
  const sample = selectedKind() === 'mock';
  let lastGroup = '';

  return (
    <AddProvider>
    <div className="app">
      <button type="button" className="skip" onClick={skip}>Skip to the page</button>
      <header className="topbar">
        <Brand />
        <span className="grow" />
        {!wide && <AddButton variant="bar" />}
        <ThemeToggle />
      </header>
      <div className="rail" role="region" aria-label="Menu">
        <Brand />
        {wide && <AddButton variant="rail" />}
        <nav aria-label="Main">
          {ALL.map((i) => {
            const head = i.group !== lastGroup ? <div className="rail-group" key={`g-${i.group}`}>{GROUP_LABEL[i.group]}</div> : null;
            lastGroup = i.group;
            return (
              <div key={i.to}>
                {head}
                <NavLink to={i.to} end={i.to === '/'} className="rail-item" data-testid={`nav-${i.label.toLowerCase()}`}>
                  <i.icon size={19} aria-hidden />
                  <span>{i.label}</span>
                  {marks(i)}
                </NavLink>
              </div>
            );
          })}
        </nav>
        <div className="rail-foot">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <ThemeToggle />
            <button type="button" className="icon-btn" aria-label="Refresh all" onClick={() => void store.refreshAll()}><RefreshCw size={16} aria-hidden /></button>
          </div>
          <span className="hint mono">updated {synced}{sample ? ' · sample data' : ''}</span>
        </div>
      </div>
      <div className="main">
        {!online && <div className="banner offline" role="status" data-testid="offline-banner">You are offline. This is how things stood at {synced}.</div>}
        {sample && <div className="banner" role="status" data-testid="sample-banner">Sample data. Nothing here is saved to your account.</div>}
        {banners.map((b) => <Banner key={b.id} b={b} />)}
        <main className="content" id="main" tabIndex={-1} ref={mainRef}>
          {filtered && <div className="mode-line" data-testid="mode-line">{modeSwitch}</div>}
          {children}
        </main>
      </div>
      <nav className="tabbar" aria-label="Tabs">
        {tabs().map((i) => (
          <NavLink key={i.to} to={i.to} end={i.to === '/'} className="tab" data-testid={`tab-${i.label.toLowerCase()}`}>
            <i.icon size={20} aria-hidden />
            <span>{i.label}</span>
            {marks(i)}
          </NavLink>
        ))}
      </nav>
      <Toasts />
    </div>
    </AddProvider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <TaskSheetProvider>
      <ReminderSheetProvider>
        <NoteSheetProvider>
          <ClaudeSheetProvider>{children}</ClaudeSheetProvider>
        </NoteSheetProvider>
      </ReminderSheetProvider>
    </TaskSheetProvider>
  );
}
