export type Area = 'work' | 'personal';
export type Mode = Area;

export type Task = {
  id: string;
  title: string;
  notes: string | null;
  area: Area;
  status: 'open' | 'done' | 'dropped';
  due_date: string | null;
  due_time: string | null;
  planned_for: string | null;
  priority: number;
  est_minutes: number | null;
  project: string | null;
  source: string;
  source_ref: string | null;
  waiting_on: string | null;
  next_action: string | null;
  cost_usd: number | null;
  sort_order: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  pushed_at?: string | null;
};

/** One row of Google Calendar, kept by the server (migration 0010). The app only reads these. */
export type CalendarEvent = {
  id: string;
  title: string;
  /** Null on an all-day event. */
  starts_at: string | null;
  ends_at: string | null;
  all_day_from: string | null;
  /** The day after the last day, as Google gives it. */
  all_day_to: string | null;
  /** False when Google marks it Free: it shows, but it does not block the day. */
  busy: boolean;
  html_link: string | null;
  meet_link: string | null;
  /** Set when this event is the calendar copy of a task. The task row shows instead. */
  task_id: string | null;
};

/** The one row that says how the Google Calendar link is doing. */
export type CalendarState = { id: boolean; linked: boolean; last_ok_at: string | null; problem: string | null };

export type Repeat = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'custom';

export type Reminder = {
  id: string;
  title: string;
  notes: string | null;
  area: Area;
  remind_at: string | null;
  time_local: string | null;
  repeat: Repeat;
  repeat_days: number[] | null;
  active: boolean;
  last_fired_at: string | null;
  task_id: string | null;
  /** Set on the one-off copy that "In 10 min" makes; the copy is deleted when it fires (migration 0008). */
  snooze_of: string | null;
  created_at: string;
  updated_at: string;
};

export type Day = {
  day: string;
  plan: string | null;
  review: string | null;
  top_task_ids: string[] | null;
  mood: number | null;
  created_at?: string;
  updated_at?: string;
};

export type Habit = {
  id: string;
  name: string;
  area: Area;
  days: number[];
  time_local: string | null;
  active: boolean;
  sort_order: number;
  created_at: string;
  last_pushed_on?: string | null;
};

export type HabitLog = { habit_id: string; day: string; done: boolean; note: string | null; created_at: string };

export type Severity = 'info' | 'good' | 'warn' | 'bad';

export type OsEvent = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  severity: Severity;
  area: Area;
  source: string | null;
  url: string | null;
  occurred_at: string;
  read_at: string | null;
  created_at: string;
  pushed_at?: string | null;
};

export type Campaign = {
  id: number;
  taken_at: string;
  channel: 'email' | 'sms';
  account: string;
  campaign_id: string;
  campaign_name: string;
  status: string | null;
  sent_total: number | null;
  replies_total: number | null;
  positives_total: number | null;
  bounces_total: number | null;
  opens_total: number | null;
  leads_total: number | null;
  raw: Record<string, unknown> | null;
};

/** One row of the os_campaign_daily view: the last snapshot of each campaign per IST day (history for deltas and sparklines). */
export type Snapshot = Omit<Campaign, 'raw' | 'campaign_name' | 'status' | 'opens_total' | 'leads_total'> & {
  ist_day?: string; status?: string | null; opens_total?: number | null; leads_total?: number | null;
};

export type SmsDay = {
  day: string;
  account: string;
  sent: number | null;
  replies: number | null;
  positives: number | null;
  negatives: number | null;
  stops: number | null;
  capped: boolean;
};

export type Note = {
  id: string;
  title: string;
  body: string;
  area: Area;
  pinned: boolean;
  created_at: string;
  updated_at: string;
};

export type FinanceEntry = {
  id: string;
  kind: 'cost' | 'revenue';
  label: string;
  amount: number;
  currency: string;
  recurrence: 'monthly' | 'one_time';
  month: string;
  end_month: string | null;
  source: string;
  source_ref: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type PushSub = { endpoint: string; p256dh: string; auth: string; device_label: string | null; created_at: string };

export type SettingRow = { key: string; value: unknown; updated_at: string };

export type Balance = { value: number | null; limit: number | null; taken_at: string | null };

export type ClaudeStatus = 'queued' | 'firing' | 'sent' | 'done' | 'failed' | 'cancelled';
/** Queued, being fired, or with the routine: Claude still owes an answer. */
export const IN_FLIGHT: readonly ClaudeStatus[] = ['queued', 'firing', 'sent'];
export const inFlight = (s: ClaudeStatus) => IN_FLIGHT.includes(s);

/** One request handed to Claude Code (migrations 0006, 0007). The VPS poller fires the routine and fills session_url. */
export type ClaudeRequest = {
  id: string;
  area: Area;
  task_id: string | null;
  title: string;
  brief: string;
  status: ClaudeStatus;
  session_url: string | null;
  result: string | null;
  error: string | null;
  sent_at: string | null;
  finished_at: string | null;
  /** How many times the poller tried to fire it. */
  attempts: number;
  /** routine: the sender fires it. copy: the owner pasted the brief into Claude Code himself (migration 0008). */
  handoff: 'routine' | 'copy';
  /** When the owner saw the result. Null keeps a finished request on Today. */
  seen_at: string | null;
  /** Set by the database (auth.uid()). The app never sends it. */
  created_by?: string | null;
  created_at: string;
  updated_at: string;
};
