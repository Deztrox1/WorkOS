export type TableName =
  | 'os_tasks'
  | 'os_reminders'
  | 'os_days'
  | 'os_habits'
  | 'os_habit_logs'
  | 'os_events'
  | 'os_campaign_snapshots'
  | 'os_campaign_daily'
  | 'os_campaign_baseline24'
  | 'os_campaigns_latest'
  | 'os_settings'
  | 'os_notes'
  | 'os_finance_entries'
  | 'os_push_subscriptions'
  | 'os_sms_days'
  | 'os_claude_requests'
  | 'os_calendar_events'
  | 'os_calendar_state';

export const ALL_TABLES: TableName[] = [
  'os_tasks', 'os_reminders', 'os_days', 'os_habits', 'os_habit_logs', 'os_events',
  'os_campaign_snapshots', 'os_settings', 'os_notes', 'os_finance_entries', 'os_push_subscriptions', 'os_sms_days', 'os_claude_requests',
];

export type Op = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'is' | 'in';
export type Filter = [col: string, op: Op, value: unknown];
export type Query = {
  filters?: Filter[];
  /** OR over these, ANDed with `filters`. A list inside is one AND group. */
  any?: (Filter | Filter[])[];
  order?: [col: string, dir: 'asc' | 'desc'][];
  limit?: number;
  /** Rows from..to, both included (PostgREST .range). Used to page past the API row cap (QA r2 D01). */
  range?: [from: number, to: number];
  columns?: string;
};

export type Row = Record<string, unknown>;

export type AuthUser = { email: string };

export interface AuthClient {
  getUser(): Promise<AuthUser | null>;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  resetPassword(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  /** Accept a recovery token captured from the URL hash. Refused when a different user is signed in (QA r2 S08). */
  acceptRecovery(token: { access_token: string; refresh_token: string }): Promise<void>;
  onChange(cb: (user: AuthUser | null) => void): () => void;
}

export interface DataClient {
  kind: 'mock' | 'supabase';
  auth: AuthClient;
  select(table: TableName, q?: Query): Promise<Row[]>;
  insert(table: TableName, rows: Row | Row[]): Promise<Row[]>;
  /** Resolves to the number of rows changed. 0 means the match no longer held (a guarded write lost the race). */
  update(table: TableName, match: Row, patch: Row): Promise<number>;
  upsert(table: TableName, row: Row, onConflict: string): Promise<Row[]>;
  remove(table: TableName, match: Row): Promise<void>;
  /** Realtime changes: inserts only, or every event ('*'). Returns an unsubscribe function. */
  subscribe(table: TableName, onChange: (row: Row) => void, events?: 'INSERT' | '*'): () => void;
}

/** An error from a write. `code` is the Postgres code when there is one. */
export type DataError = Error & { code?: string };
export const dataError = (message: string, code?: string): DataError => Object.assign(new Error(message), code ? { code } : {});
/** A unique or primary key clash (Postgres 23505). */
export const isDuplicate = (e: unknown) => (e as DataError | null)?.code === '23505';
/** A clash on the row's own key (`<table>_pkey`): the first try landed and only its reply was lost (QA r2 D07). */
export const isPrimaryDup = (e: unknown) => isDuplicate(e) && /_pkey\b/.test((e as Error).message ?? '');
/** A rule the database refuses on purpose (SQLSTATE class 22 or 23 except a duplicate). A retry cannot help (QA r2 D08). */
export const isRuleError = (e: unknown) => {
  const c = (e as DataError | null)?.code ?? '';
  return /^2[23]/.test(c) && c !== '23505';
};

/** The `sub` claim of a JWT, or null when the text is not one. Only used to compare, never to trust. */
export function jwtSub(token: string): string | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === 'string' ? sub : null;
  } catch {
    return null;
  }
}
