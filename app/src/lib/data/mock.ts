import { dataError, type AuthClient, type AuthUser, type DataClient, type Filter, type Query, type Row, type TableName } from './types';
import { emptyState, seed, type MockState } from './fixtures';
import { istDate } from '../../shared/ist';

const KEY = 'workos.mock.v1';
const SESSION = 'workos.mock.session';
const FAIL = 'workos.mock.fail';
const PK: Partial<Record<TableName, string[]>> = {
  os_days: ['day'], os_settings: ['key'], os_push_subscriptions: ['endpoint'],
  os_habit_logs: ['habit_id', 'day'], os_sms_days: ['day', 'account'],
};

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/** writes: the next n writes fail. lost: the next n writes land, then the reply is lost (the app sees an error). */
type Fail = { reads?: Partial<Record<TableName, number>>; writes?: number; lost?: number };
const OPEN_CLAUDE = ['queued', 'firing', 'sent'];
const dup = (constraint: string) => dataError(`duplicate key value violates unique constraint "${constraint}"`, '23505');
/** A rule the database refuses (a CHECK or a trigger, migrations 0007 and 0008). */
const refuse = (message: string) => dataError(message, '23514');
const SERVER_KEYS = ['claude_routine', 'claude_fire_budget', 'owner_uid'];
const FINAL = ['done', 'failed', 'cancelled'];
/** What the app's own session may move a request to. The poller (no session) does the rest, outside the mock client. */
const APP_MOVES: Record<string, string[]> = { queued: ['cancelled', 'failed'], sent: ['done', 'failed', 'cancelled'] };
const FROZEN = ['brief', 'title', 'area', 'handoff', 'created_by', 'created_at'];
const PUSH_HOSTS = ['fcm.googleapis.com', 'web.push.apple.com'];
const pushOk = (endpoint: string) => {
  if (endpoint.startsWith('mock://')) return true;
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && (PUSH_HOSTS.includes(u.hostname) || u.hostname.endsWith('.push.services.mozilla.com') || u.hostname.endsWith('.notify.windows.com'));
  } catch {
    return false;
  }
};
const sessionOk = (url: unknown) => url === null || url === undefined || (typeof url === 'string' && url.startsWith('https://claude.ai/'));

export type MockApi = {
  reset(): void;
  seed(tables: Partial<MockState>): void;
  get(table: TableName): Row[];
  /** Insert as if another device did. notify=true also fires realtime listeners. */
  external(table: TableName, row: Row, notify?: boolean): void;
  /** Change rows as if another device did, without telling this page. */
  externalUpdate(table: TableName, match: Row, patch: Row): void;
  setFail(f: Fail): void;
};

declare global {
  interface Window {
    __mock?: MockApi;
  }
}

function matches(row: Row, [col, op, val]: Filter): boolean {
  const v = row[col];
  switch (op) {
    case 'eq': return v === val;
    case 'neq': return v !== val;
    case 'gt': return v !== null && v !== undefined && (v as string) > (val as string);
    case 'gte': return v !== null && v !== undefined && (v as string) >= (val as string);
    case 'lt': return v !== null && v !== undefined && (v as string) < (val as string);
    case 'lte': return v !== null && v !== undefined && (v as string) <= (val as string);
    case 'is': return val === null ? v === null || v === undefined : v === val;
    case 'in': return (val as unknown[]).includes(v);
  }
}

export function createMockClient(): DataClient {
  let state: MockState;
  try {
    const raw = localStorage.getItem(KEY);
    state = raw ? ({ ...emptyState(), ...(JSON.parse(raw) as Partial<MockState>) }) : seed(Date.now());
  } catch {
    state = seed(Date.now());
  }
  const listeners = new Map<TableName, Set<(r: Row) => void>>();
  let fail: Fail = {};
  try {
    fail = JSON.parse(localStorage.getItem(FAIL) ?? '{}') as Fail;
  } catch { /* ignore */ }

  const persist = () => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* quota */ }
  };
  persist();

  const requireOnline = () => {
    if (!navigator.onLine) throw new Error('offline');
  };
  const latestView = (): Row[] => {
    const best = new Map<string, Row>();
    for (const r of state.os_campaign_snapshots) {
      const k = `${r.account}|${r.campaign_id}`;
      const cur = best.get(k);
      if (!cur || (r.taken_at as string) > (cur.taken_at as string)) best.set(k, r);
    }
    return [...best.values()];
  };
  // os_campaign_daily (migration 0007): the last snapshot per campaign per IST day, the last 31 days.
  const dailyView = (): Row[] => {
    const since = Date.now() - 31 * 86_400_000;
    const best = new Map<string, Row>();
    for (const r of state.os_campaign_snapshots) {
      const t = new Date(r.taken_at as string).getTime();
      if (t < since) continue;
      const day = istDate(t);
      const k = `${r.account}|${r.campaign_id}|${day}`;
      const cur = best.get(k);
      if (!cur || (r.taken_at as string) > (cur.taken_at as string)) best.set(k, { ...r, ist_day: day });
    }
    return [...best.values()];
  };
  // os_campaign_baseline24 (migration 0008): per campaign, the newest snapshot taken 24 to 48 hours ago.
  const baselineView = (): Row[] => {
    const hi = Date.now() - 24 * 3600_000;
    const lo = Date.now() - 48 * 3600_000;
    const best = new Map<string, Row>();
    for (const r of state.os_campaign_snapshots) {
      const t = new Date(r.taken_at as string).getTime();
      if (t > hi || t < lo) continue;
      const k = `${r.account}|${r.campaign_id}`;
      const cur = best.get(k);
      if (!cur || (r.taken_at as string) > (cur.taken_at as string)) best.set(k, { ...r, ist_day: istDate(t) });
    }
    return [...best.values()];
  };
  const rowsOf = (t: TableName): Row[] => (t === 'os_campaigns_latest' ? latestView() : t === 'os_campaign_daily' ? dailyView() : t === 'os_campaign_baseline24' ? baselineView() : state[t]);
  /** `col` or PostgREST's `alias:col->>key`. */
  const pick = (r: Row, spec: string): [string, unknown] => {
    const m = /^(\w+):(\w+)->>(\w+)$/.exec(spec);
    if (!m) return [spec, r[spec]];
    const v = (r[m[2]] as Row | null | undefined)?.[m[3]];
    return [m[1], v === undefined || v === null ? null : String(v)];
  };
  const sameKey = (t: TableName, a: Row, b: Row) => (PK[t] ?? ['id']).every((k) => a[k] === b[k]);
  const emit = (t: TableName, row: Row) => listeners.get(t)?.forEach((cb) => cb(clone(row)));
  const maybeFailWrite = () => {
    if (fail.writes && fail.writes > 0) {
      fail.writes -= 1;
      throw new Error('500 mock write failure');
    }
  };
  /** After a write landed: lose the reply when asked to. */
  const maybeLoseReply = () => {
    if (fail.lost && fail.lost > 0) {
      fail.lost -= 1;
      throw new Error('mock reply lost');
    }
  };

  const user = (): AuthUser | null => {
    const e = localStorage.getItem(SESSION);
    return e ? { email: e } : null;
  };
  const authListeners = new Set<(u: AuthUser | null) => void>();
  const auth: AuthClient = {
    async getUser() { return user(); },
    async signIn(email, password) {
      if (!email || password === 'wrong-pass' || password.length < 1) throw new Error('Invalid login credentials');
      localStorage.setItem(SESSION, email);
      authListeners.forEach((cb) => cb({ email }));
    },
    async signUp(email, password) {
      if (!email || password.length < 6) throw new Error('Password should be at least 6 characters.');
      localStorage.setItem(SESSION, email);
      authListeners.forEach((cb) => cb({ email }));
    },
    async signOut() {
      localStorage.removeItem(SESSION);
      authListeners.forEach((cb) => cb(null));
    },
    async resetPassword(email) {
      const w = window as unknown as { __resetRequests?: string[] };
      (w.__resetRequests ??= []).push(email);
    },
    async updatePassword(password) {
      if (password.length < 6) throw new Error('Password should be at least 6 characters.');
      localStorage.setItem('workos.mock.password', password);
    },
    async acceptRecovery(token) {
      // The real client refuses a link whose user differs from the signed-in one; sample tokens carry no user, so any session refuses (QA r2 S08).
      if (user()) throw new Error('This link cannot be used while you are signed in.');
      if (token.access_token) localStorage.setItem(SESSION, 'recovery@example.com');
    },
    onChange(cb) { authListeners.add(cb); return () => authListeners.delete(cb); },
  };

  const api: MockApi = {
    reset() { state = seed(Date.now()); persist(); },
    seed(t) { state = { ...emptyState(), ...clone(t) }; persist(); },
    get(t) { return clone(rowsOf(t)); },
    external(t, row, notify = false) {
      state[t].push(clone(row));
      persist();
      if (notify) emit(t, row);
    },
    externalUpdate(t, match, patch) {
      for (const r of state[t]) if (Object.entries(match).every(([k, v]) => r[k] === v)) Object.assign(r, clone(patch));
      persist();
    },
    setFail(f) { fail = f; },
  };
  window.__mock = api;

  return {
    kind: 'mock',
    auth,
    async select(table, q: Query = {}) {
      requireOnline();
      const lat = Number(localStorage.getItem('workos.mock.latency') || 0);
      if (lat) await new Promise((r) => setTimeout(r, lat));
      const left = fail.reads?.[table];
      if (left && left > 0) {
        fail.reads![table] = left - 1;
        throw new Error('500 mock read failure');
      }
      let rows = rowsOf(table).filter((r) => (q.filters ?? []).every((f) => matches(r, f)) && (!q.any?.length || q.any.some((f) => (typeof f[0] === 'string' ? matches(r, f as Filter) : (f as Filter[]).every((g) => matches(r, g))))));
      for (const [col, dir] of [...(q.order ?? [])].reverse()) {
        rows = [...rows].sort((a, b) => {
          const x = a[col] as string | number | null;
          const y = b[col] as string | number | null;
          if (x === y) return 0;
          if (x === null || x === undefined) return 1;
          if (y === null || y === undefined) return -1;
          return (x < y ? -1 : 1) * (dir === 'asc' ? 1 : -1);
        });
      }
      if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
      else if (q.limit) rows = rows.slice(0, q.limit);
      if (q.columns && q.columns !== '*') {
        const cols = q.columns.split(',').map((c) => c.trim());
        rows = rows.map((r) => Object.fromEntries(cols.map((c) => pick(r, c))));
      }
      return clone(rows);
    },
    async insert(table, rows) {
      requireOnline();
      maybeFailWrite();
      const list = Array.isArray(rows) ? rows : [rows];
      const out: Row[] = [];
      for (const r of list) {
        const now = new Date().toISOString();
        const row: Row = { ...clone(r) };
        if (!PK[table] && !row.id) row.id = uuid();
        if ('created_at' in (state[table][0] ?? {}) || table !== 'os_settings') row.created_at ??= now;
        if (state[table].some((x) => sameKey(table, x, row))) throw dup(`${table}_pkey`);
        if (table === 'os_tasks') {
          row.updated_at ??= now;
          if (row.source_ref && state.os_tasks.some((t) => t.source === row.source && t.source_ref === row.source_ref)) throw dup('os_tasks_source_source_ref_key');
        }
        if (table === 'os_settings' && SERVER_KEYS.includes(row.key as string)) throw dataError('permission denied for table os_settings', '42501');
        if (table === 'os_push_subscriptions' && !pushOk(String(row.endpoint ?? ''))) throw refuse('push endpoint is not a known push host');
        if (table === 'os_reminders') row.snooze_of ??= null;
        if (table === 'os_claude_requests') {
          // 0008: routine rows start queued, copy hand-offs start sent (the database stamps sent_at)
          row.handoff ??= 'routine';
          if (row.handoff !== 'routine' && row.handoff !== 'copy') throw refuse('handoff must be routine or copy');
          if (row.status !== (row.handoff === 'copy' ? 'sent' : 'queued')) throw refuse('a new request starts queued, or sent for a copy hand-off');
          if (row.handoff === 'copy') row.sent_at = now;
          if (String(row.title ?? '').length > 500 || String(row.brief ?? '').length > 20_000) throw refuse('title or brief too long');
          if (!sessionOk(row.session_url)) throw refuse('session_url must start with https://claude.ai/');
          // 0007: a task has at most one open request
          if (row.task_id && OPEN_CLAUDE.includes(row.status as string) && state.os_claude_requests.some((x) => x.task_id === row.task_id && OPEN_CLAUDE.includes(x.status as string))) throw dup('os_claude_requests_one_open_per_task');
          row.attempts ??= 0;
          row.seen_at ??= null;
          row.created_by ??= 'mock-owner';
        }
        state[table].push(row);
        out.push(row);
        if (table === 'os_events' || table === 'os_campaign_snapshots' || table === 'os_claude_requests') emit(table, row);
      }
      persist();
      maybeLoseReply();
      return clone(out);
    },
    async update(table, match, patch) {
      requireOnline();
      maybeFailWrite();
      if (table === 'os_settings' && SERVER_KEYS.includes(match.key as string)) throw dataError('permission denied for table os_settings', '42501');
      const hit = state[table].filter((r) => Object.entries(match).every(([k, v]) => (Array.isArray(v) ? v.includes(r[k]) : r[k] === v)));
      const now = new Date().toISOString();
      if (table === 'os_claude_requests') {
        // 0008: the checks run before anything changes, like a trigger would
        for (const r of hit) {
          for (const k of FROZEN) if (k in patch && patch[k] !== r[k]) throw refuse(`${k} cannot change after the request is sent`);
          if ('task_id' in patch && patch.task_id !== null && patch.task_id !== r.task_id) throw refuse('task_id can only be cleared');
          if ('attempts' in patch && patch.attempts !== r.attempts) throw refuse('only the sender changes attempts');
          if ('session_url' in patch && !sessionOk(patch.session_url)) throw refuse('session_url must start with https://claude.ai/');
          const next = patch.status as string | undefined;
          if (FINAL.includes(r.status as string)) {
            if (Object.keys(patch).some((k) => k !== 'seen_at' && patch[k] !== r[k])) throw refuse('a finished request cannot change, except seen_at');
          } else if (next && next !== r.status && !(APP_MOVES[r.status as string] ?? []).includes(next)) {
            throw refuse(`a ${r.status as string} request cannot become ${next}`);
          }
        }
      }
      if (table === 'os_reminders' && 'snooze_of' in patch && hit.some((r) => r.snooze_of !== patch.snooze_of)) throw refuse('snooze_of cannot change');
      for (const r of hit) {
        Object.assign(r, clone(patch));
        if ('updated_at' in r || ['os_tasks', 'os_reminders', 'os_notes', 'os_finance_entries', 'os_days', 'os_settings'].includes(table)) r.updated_at = now;
        if (table === 'os_claude_requests') emit(table, r);
      }
      persist();
      maybeLoseReply();
      return hit.length;
    },
    async upsert(table, row, _onConflict) {
      requireOnline();
      maybeFailWrite();
      if (table === 'os_settings' && SERVER_KEYS.includes(row.key as string)) throw dataError('permission denied for table os_settings', '42501');
      if (table === 'os_push_subscriptions' && !pushOk(String(row.endpoint ?? ''))) throw refuse('push endpoint is not a known push host');
      const now = new Date().toISOString();
      const idx = state[table].findIndex((r) => sameKey(table, r, row));
      if (idx >= 0) {
        Object.assign(state[table][idx], clone(row), { updated_at: now });
      } else {
        const r: Row = { ...clone(row), created_at: now, updated_at: now };
        if (!PK[table] && !r.id) r.id = uuid();
        state[table].push(r);
      }
      persist();
      maybeLoseReply();
      return clone([state[table][idx >= 0 ? idx : state[table].length - 1]]);
    },
    async remove(table, match) {
      requireOnline();
      maybeFailWrite();
      if (table === 'os_settings' && SERVER_KEYS.includes(match.key as string)) throw dataError('permission denied for table os_settings', '42501');
      const gone = (r: Row) => Object.entries(match).every(([k, v]) => (Array.isArray(v) ? v.includes(r[k]) : r[k] === v));
      const removed = state[table].filter(gone).map((r) => r.id);
      state[table] = state[table].filter((r) => !gone(r));
      // os_reminders.snooze_of references os_reminders(id) on delete cascade
      if (table === 'os_reminders') state.os_reminders = state.os_reminders.filter((r) => !removed.includes(r.snooze_of));
      // task_id references os_tasks(id) on delete set null (reminders, Claude requests); top_task_ids is cleaned by a trigger
      if (table === 'os_tasks') {
        for (const t of ['os_reminders', 'os_claude_requests'] as const) state[t] = state[t].map((r) => (removed.includes(r.task_id) ? { ...r, task_id: null } : r));
        state.os_days = state.os_days.map((d) => ({ ...d, top_task_ids: ((d.top_task_ids as string[] | null) ?? []).filter((id) => !removed.includes(id)) }));
      }
      persist();
    },
    subscribe(table, cb, _events) {
      const set = listeners.get(table) ?? new Set();
      set.add(cb);
      listeners.set(table, set);
      return () => set.delete(cb);
    },
  };
}
