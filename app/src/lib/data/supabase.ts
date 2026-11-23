import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { dataError, jwtSub, type AuthClient, type AuthUser, type DataClient, type Filter, type Query, type Row, type TableName } from './types';

const DEFAULT_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
const LIVE_KEY = 'workos.live';

/** Build-time env first; otherwise the URL and anon key typed in Settings (localStorage, never committed). */
export function liveConfig(): { url: string; key: string; source: 'env' | 'settings' | 'none' } {
  const envKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || '';
  const envUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || DEFAULT_URL;
  if (envKey) return { url: envUrl, key: envKey, source: 'env' };
  try {
    const v = JSON.parse(localStorage.getItem(LIVE_KEY) ?? 'null') as { url?: string; key?: string } | null;
    if (v?.key) return { url: v.url || envUrl, key: v.key, source: 'settings' };
  } catch { /* ignore */ }
  return { url: envUrl, key: '', source: 'none' };
}
export function saveLiveConfig(url: string, key: string) {
  localStorage.setItem(LIVE_KEY, JSON.stringify({ url: url.trim(), key: key.trim() }));
}
export function clearLiveConfig() {
  localStorage.removeItem(LIVE_KEY);
}
export function hasLiveConfig(): boolean {
  return liveConfig().key.length > 0;
}

/** One key column per table, so an update can ask for just that and count the rows it changed. */
const PK_COL: Partial<Record<TableName, string>> = { os_days: 'day', os_settings: 'key', os_push_subscriptions: 'endpoint', os_habit_logs: 'habit_id', os_sms_days: 'day' };

function fail(error: { message: string; code?: string } | null): void {
  if (error) throw dataError(error.message, error.code);
}

/** One PostgREST logic-tree term. Values are quoted, since timestamps carry reserved characters (: and .). */
function orTerm([col, op, val]: Filter): string {
  if (op === 'is' || val === null) return `${col}.is.null`;
  if (op === 'in') return `${col}.in.(${(val as unknown[]).map((v) => `"${String(v)}"`).join(',')})`;
  return `${col}.${op}."${String(val).replace(/"/g, '')}"`;
}

const anyTerm = (f: Filter | Filter[]): string => (typeof f[0] === 'string' ? orTerm(f as Filter) : `and(${(f as Filter[]).map(orTerm).join(',')})`);

export function createSupabaseClient(): DataClient {
  const cfg = liveConfig();
  const sb: SupabaseClient = createClient(cfg.url, cfg.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

  const toUser = (email: string | undefined | null): AuthUser | null => (email ? { email } : null);

  const auth: AuthClient = {
    async getUser() {
      const { data } = await sb.auth.getSession();
      return toUser(data.session?.user.email);
    },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      fail(error);
    },
    async signUp(email, password) {
      const { error } = await sb.auth.signUp({ email, password });
      fail(error);
    },
    async signOut() {
      await sb.auth.signOut();
    },
    async resetPassword(email) {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/#/reset` });
      fail(error);
    },
    async updatePassword(password) {
      const { error } = await sb.auth.updateUser({ password });
      fail(error);
    },
    async acceptRecovery(token) {
      // A crafted link must not swap the signed-in owner's session (QA r2 S08).
      const { data } = await sb.auth.getSession();
      const cur = data.session?.user.id;
      if (cur && jwtSub(token.access_token) !== cur) throw dataError('This link cannot be used while you are signed in.');
      const { error } = await sb.auth.setSession(token);
      fail(error);
    },
    onChange(cb) {
      const { data } = sb.auth.onAuthStateChange((_e, session) => cb(toUser(session?.user.email)));
      return () => data.subscription.unsubscribe();
    },
  };

  return {
    kind: 'supabase',
    auth,
    async select(table, q: Query = {}) {
      let b = sb.from(table).select(q.columns ?? '*');
      for (const [col, op, val] of q.filters ?? []) {
        if (op === 'in') b = b.in(col, val as unknown[]);
        else if (op === 'is') b = b.is(col, val as null);
        else if (op === 'eq') b = b.eq(col, val as never);
        else if (op === 'neq') b = b.neq(col, val as never);
        else if (op === 'gt') b = b.gt(col, val as never);
        else if (op === 'gte') b = b.gte(col, val as never);
        else if (op === 'lt') b = b.lt(col, val as never);
        else b = b.lte(col, val as never);
      }
      if (q.any?.length) b = b.or(q.any.map(anyTerm).join(','));
      for (const [col, dir] of q.order ?? []) b = b.order(col, { ascending: dir === 'asc' });
      if (q.range) b = b.range(q.range[0], q.range[1]);
      else if (q.limit) b = b.limit(q.limit);
      const { data, error } = await b;
      fail(error);
      return (data ?? []) as unknown as Row[];
    },
    async insert(table, rows) {
      const { data, error } = await sb.from(table).insert(rows as never).select();
      fail(error);
      return (data ?? []) as Row[];
    },
    async update(table, match, patch) {
      let b = sb.from(table).update(patch as never);
      for (const [k, v] of Object.entries(match)) b = Array.isArray(v) ? b.in(k, v as never) : b.eq(k, v as never);
      const { data, error } = await b.select(PK_COL[table] ?? 'id');
      fail(error);
      return (data ?? []).length;
    },
    async upsert(table, row, onConflict) {
      const { data, error } = await sb.from(table).upsert(row as never, { onConflict }).select();
      fail(error);
      return (data ?? []) as Row[];
    },
    async remove(table, match) {
      let b = sb.from(table).delete();
      for (const [k, v] of Object.entries(match)) b = Array.isArray(v) ? b.in(k, v as never) : b.eq(k, v as never);
      const { error } = await b;
      fail(error);
    },
    subscribe(table: TableName, onChange, events = 'INSERT') {
      const ch = sb
        .channel(`rt-${table}-${Math.random().toString(36).slice(2)}`)
        .on('postgres_changes', { event: events as '*', schema: 'public', table }, (p) => onChange(p.new as Row))
        .subscribe();
      return () => {
        void sb.removeChannel(ch);
      };
    },
  };
}
