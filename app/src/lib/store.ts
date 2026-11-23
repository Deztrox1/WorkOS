import { useEffect, useSyncExternalStore } from 'react';
import { addDays, istDate, istToMs } from '../shared/ist';
import { getClient } from './data';
import type { Query, Row, TableName } from './data';
import type {
  CalendarEvent, CalendarState, Campaign, ClaudeRequest, Day, FinanceEntry, Habit, HabitLog, Note, OsEvent, PushSub, Reminder, SettingRow, Snapshot, SmsDay, Task,
} from './types';

export type SliceKey =
  | 'tasks' | 'reminders' | 'days' | 'habits' | 'habit_logs' | 'events' | 'unread' | 'snapshots'
  | 'baseline' | 'campaigns' | 'sms_days' | 'notes' | 'finance' | 'settings' | 'push_subs' | 'claude'
  | 'calendar' | 'calendar_state';

type Types = {
  tasks: Task; reminders: Reminder; days: Day; habits: Habit; habit_logs: HabitLog; events: OsEvent; unread: OsEvent;
  snapshots: Snapshot; baseline: Snapshot; campaigns: Campaign; sms_days: SmsDay; notes: Note; finance: FinanceEntry;
  settings: SettingRow; push_subs: PushSub; claude: ClaudeRequest; calendar: CalendarEvent; calendar_state: CalendarState;
};

export type Slice<T> = {
  rows: T[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  syncedAt: number | null;
  /** true when the last fetch failed and rows come from the local cache */
  stale: boolean;
};

export const PAGE = 50;

const TABLE: Record<SliceKey, TableName> = {
  tasks: 'os_tasks', reminders: 'os_reminders', days: 'os_days', habits: 'os_habits', habit_logs: 'os_habit_logs',
  events: 'os_events', unread: 'os_events', snapshots: 'os_campaign_daily', baseline: 'os_campaign_baseline24', campaigns: 'os_campaigns_latest',
  sms_days: 'os_sms_days', notes: 'os_notes', finance: 'os_finance_entries', settings: 'os_settings', push_subs: 'os_push_subscriptions',
  claude: 'os_claude_requests', calendar: 'os_calendar_events', calendar_state: 'os_calendar_state',
};

/** Slices cached in localStorage for offline reading (PRD 2 Offline). Snapshots are too big to cache. */
const CACHED: SliceKey[] = ['tasks', 'reminders', 'days', 'habits', 'habit_logs', 'events', 'unread', 'campaigns', 'sms_days', 'settings', 'notes', 'finance', 'claude', 'calendar', 'calendar_state'];

export const nowMs = () => Date.now();

/** The campaigns view without `raw` (QA r1 D23): only the two raw keys the app reads come back, as text. */
const SNAP_COLS = 'id,taken_at,ist_day,channel,account,campaign_id,sent_total,replies_total,positives_total,bounces_total';
/** One API page. The default cap is 1,000 rows a reply; a short page means the last one. */
const API_PAGE = 1000;
const MAX_PAGES = 30;
const CAMPAIGN_COLS = 'id,taken_at,channel,account,campaign_id,campaign_name,status,sent_total,replies_total,positives_total,bounces_total,'
  + 'opens_total,leads_total,playbook_status:raw->>playbook_status,location_id:raw->>location_id';

function query(key: SliceKey, ctx: { limit: number }): Query {
  const today = istDate(nowMs());
  switch (key) {
    // Open tasks plus the ones closed in the last 30 days, in a stable order (QA r1 D14).
    case 'tasks':
      return {
        any: [['status', 'eq', 'open'], ['updated_at', 'gte', new Date(nowMs() - 30 * 86_400_000).toISOString()]],
        order: [['sort_order', 'asc'], ['id', 'asc']], limit: 5000,
      };
    case 'reminders': return { order: [['created_at', 'asc']] };
    case 'days': return { filters: [['day', 'gte', addDays(today, -60)]] };
    case 'habits': return { order: [['sort_order', 'asc']] };
    case 'habit_logs': return { filters: [['day', 'gte', addDays(today, -120)]], order: [['day', 'desc'], ['habit_id', 'asc']] };
    case 'events': return { order: [['occurred_at', 'desc']], limit: ctx.limit };
    case 'unread': return { filters: [['read_at', 'is', null]], order: [['occurred_at', 'desc']], limit: 300 };
    // One row per campaign per IST day, built by the database (view os_campaign_daily, QA r1 D1). Newest first, and read
    // in pages (see loadAll), so the API row cap can only ever cut the oldest days (QA r2 D01). Every consumer sorts again.
    case 'snapshots':
      return { columns: SNAP_COLS, order: [['taken_at', 'desc'], ['id', 'desc']] };
    // The newest snapshot 24 to 48 hours old, per campaign: the base for the "in 24 h" numbers (view os_campaign_baseline24).
    case 'baseline': return { columns: SNAP_COLS, order: [['taken_at', 'desc'], ['id', 'desc']] };
    case 'campaigns': return { columns: CAMPAIGN_COLS, order: [['campaign_name', 'asc']] };
    case 'sms_days': return { filters: [['day', 'gte', addDays(today, -30)]] };
    case 'notes': return { order: [['updated_at', 'desc']] };
    case 'finance': return { order: [['month', 'asc']] };
    case 'settings': return {};
    case 'push_subs': return { order: [['created_at', 'asc']] };
    case 'claude': return { order: [['created_at', 'desc']], limit: 100 };
    // Yesterday to today+2 is all the screens show, and all that reaches the device (R4S13, R4B17). Timed and all-day events
    // keep their dates in different columns, so each branch has its own two ends. A timed event counts by when it ends, so
    // one that began days ago and is still running gets through (R4X11).
    case 'calendar':
      return {
        any: [
          [['ends_at', 'gte', new Date(istToMs(addDays(today, -1))).toISOString()], ['starts_at', 'lt', new Date(istToMs(addDays(today, 3))).toISOString()]],
          [['all_day_to', 'gte', today], ['all_day_from', 'lte', addDays(today, 2)]],
        ],
        order: [['starts_at', 'asc'], ['id', 'asc']], limit: 500,
      };
    case 'calendar_state': return {};
  }
}

/** Read a whole table in `.range()` pages until a short page, so no API row cap can drop rows without an error. */
async function loadAll(table: TableName, q: Query): Promise<Row[]> {
  const out: Row[] = [];
  for (let p = 0; p < MAX_PAGES; p++) {
    const page = await getClient().select(table, { ...q, range: [p * API_PAGE, (p + 1) * API_PAGE - 1] });
    out.push(...page);
    if (page.length < API_PAGE) break;
  }
  return out;
}

/** Fold the two projected raw keys back into a small `raw`, so campaign logic reads them as before. */
function slimRaw(r: Row): Row {
  const { playbook_status, location_id, ...rest } = r;
  const raw: Row = {};
  if (playbook_status !== null && playbook_status !== undefined) raw.playbook_status = playbook_status;
  if (location_id !== null && location_id !== undefined) raw.location_id = location_id;
  return { ...rest, raw };
}

const empty = <T,>(): Slice<T> => ({ rows: [], status: 'idle', syncedAt: null, stale: false });

class Store {
  private slices = new Map<SliceKey, Slice<unknown>>();
  private listeners = new Set<() => void>();
  private inflight = new Map<SliceKey, Promise<void>>();
  private wanted = new Set<SliceKey>();
  eventsLimit = PAGE;
  private cachePrefix = 'workos.cache.';
  /** Bumped by clearCache: a load that started before it writes nothing back (R4S15). */
  private generation = 0;

  constructor() {
    for (const k of CACHED) {
      try {
        const raw = localStorage.getItem(this.cachePrefix + k);
        if (raw) {
          const { rows, at } = JSON.parse(raw) as { rows: unknown[]; at: number };
          this.slices.set(k, { rows, status: 'ready', syncedAt: at, stale: true });
        }
      } catch { /* ignore */ }
    }
  }

  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  private emit() {
    // new snapshot identity per emit so useSyncExternalStore sees a change
    this.version++;
    this.listeners.forEach((l) => l());
  }
  version = 0;

  get<K extends SliceKey>(key: K): Slice<Types[K]> {
    return (this.slices.get(key) as Slice<Types[K]> | undefined) ?? (empty() as Slice<Types[K]>);
  }

  set<K extends SliceKey>(key: K, patch: Partial<Slice<Types[K]>>) {
    this.slices.set(key, { ...this.get(key), ...patch } as Slice<unknown>);
    this.emit();
  }

  setRows<K extends SliceKey>(key: K, fn: (rows: Types[K][]) => Types[K][]) {
    this.set(key, { rows: fn(this.get(key).rows) } as Partial<Slice<Types[K]>>);
  }

  ensure(key: SliceKey) {
    this.wanted.add(key);
    if (!this.loadedOnce.has(key) && !this.inflight.has(key)) void this.load(key);
  }
  private loadedOnce = new Set<SliceKey>();

  load(key: SliceKey): Promise<void> {
    const running = this.inflight.get(key);
    if (running) return running;
    const cur = this.get(key);
    if (cur.status === 'idle' || cur.status === 'error') this.set(key, { status: 'loading' } as Partial<Slice<Types[typeof key]>>);
    const gen = this.generation;
    const p = (async () => {
      try {
        let rows = key === 'snapshots'
          ? await loadAll(TABLE[key], query(key, { limit: this.eventsLimit }))
          : ((await getClient().select(TABLE[key], query(key, { limit: this.eventsLimit }))) as Row[]);
        if (gen !== this.generation) return;
        if (key === 'campaigns') rows = rows.map(slimRaw);
        this.loadedOnce.add(key);
        const at = nowMs();
        this.slices.set(key, { rows, status: 'ready', syncedAt: at, stale: false });
        this.emit();
        if (CACHED.includes(key)) {
          try {
            const keep = key === 'events' ? rows.slice(0, PAGE) : rows;
            localStorage.setItem(this.cachePrefix + key, JSON.stringify({ rows: keep, at }));
          } catch { /* quota */ }
        }
      } catch {
        if (gen !== this.generation) return;
        this.loadedOnce.add(key);
        const had = this.get(key);
        if (had.rows.length || had.syncedAt) this.slices.set(key, { ...had, status: 'ready', stale: true });
        else this.slices.set(key, { rows: [], status: 'error', syncedAt: null, stale: false });
        this.emit();
      } finally {
        if (gen === this.generation) this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, p);
    return p;
  }

  /** Refetch every slice a screen has asked for. */
  refreshAll(): Promise<void[]> {
    return Promise.all([...this.wanted].map((k) => this.load(k)));
  }
  refresh(keys: SliceKey[]) {
    return Promise.all(keys.map((k) => this.load(k)));
  }

  async loadMoreEvents() {
    this.eventsLimit += PAGE;
    await this.load('events');
  }

  clearCache() {
    for (const k of CACHED) {
      try { localStorage.removeItem(this.cachePrefix + k); } catch { /* ignore */ }
    }
    this.generation++;
    this.inflight.clear();
    this.slices.clear();
    this.loadedOnce.clear();
    this.eventsLimit = PAGE;
    this.emit();
  }
}

export const store = new Store();

export function useSlice<K extends SliceKey>(key: K): Slice<Types[K]> {
  useSyncExternalStore(store.subscribe, () => store.version);
  useEffect(() => {
    store.ensure(key);
  }, [key]);
  return store.get(key);
}

/** Subscribe to the store without asking for any slice. */
export function useStoreVersion() {
  return useSyncExternalStore(store.subscribe, () => store.version);
}

export type { Types as SliceTypes };
