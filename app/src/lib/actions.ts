import { addDays, istDate } from '../shared/ist';
import { getClient, isDuplicate, isPrimaryDup, isRuleError } from './data';
import type { Row, TableName } from './data';
import { store, nowMs } from './store';
import type { SliceKey, SliceTypes } from './store';
import { toast } from './toast';
import { closeClaudeForTask } from './claudeActions';
import type { Area, Day, FinanceEntry, Habit, HabitLog, Note, OsEvent, Reminder, Task } from './types';
import { formatDue } from './logic/format';
import type { Parsed } from './logic/quickAdd';

export const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine);
const nowIso = () => new Date(nowMs()).toISOString();
const uuid = () => crypto.randomUUID();
/** A row can only be ticked or moved with one toast: the same words everywhere, naming what changed (R4P09, R4P30). */
const undoToast = (text: string, run: () => void) => toast(text, 'ok', { label: 'Undo', run });

const TABLE: Record<string, TableName> = {
  tasks: 'os_tasks', reminders: 'os_reminders', days: 'os_days', habits: 'os_habits', habit_logs: 'os_habit_logs',
  events: 'os_events', unread: 'os_events', notes: 'os_notes', finance: 'os_finance_entries', settings: 'os_settings', push_subs: 'os_push_subscriptions',
  claude: 'os_claude_requests',
};

/**
 * ok: toast on success. quiet: no error toast. dupOk: the write is an insert with a client id, so a duplicate key on the
 * retry means the first try landed and only its reply was lost (QA r1 D4). Only a clash on the primary key says that: a
 * clash on another index, or a broken rule, is a real answer (QA r2 D07, D08). dupText: the message for a real duplicate.
 */
type Opts = { ok?: string; quiet?: boolean; dupOk?: boolean; dupText?: string };

/**
 * Optimistic write (PRD 4 Writes): apply now, retry once on failure, then revert and toast.
 * A clash on the primary key or a broken rule on the first try is a real answer, so it is not retried. Offline: nothing is sent.
 */
export async function mutate(
  keys: SliceKey[],
  apply: () => void,
  remote: () => Promise<unknown>,
  opts: Opts = {},
): Promise<boolean> {
  if (!isOnline()) {
    toast('You are offline. Changes work again when you are back.', 'error');
    return false;
  }
  const before = keys.map((k) => [k, store.get(k).rows] as const);
  apply();
  try {
    try {
      await remote();
    } catch (first) {
      if (isPrimaryDup(first) || isRuleError(first)) throw first;
      try {
        await remote();
      } catch (again) {
        if (!(opts.dupOk && isPrimaryDup(again))) throw again;
      }
    }
    if (opts.ok) toast(opts.ok);
    return true;
  } catch (e) {
    for (const [k, rows] of before) store.set(k, { rows } as never);
    if (!opts.quiet) toast(isDuplicate(e) && opts.dupText ? opts.dupText : 'Not saved. Your change was undone. Try again.', 'error');
    return false;
  }
}

type Rows<K extends SliceKey> = SliceTypes[K][];
const same = (a: Row, match: Row) => Object.entries(match).every(([k, v]) => (Array.isArray(v) ? v.includes(a[k]) : a[k] === v));

export function patchRow<K extends SliceKey>(key: K, match: Row, patch: Row, opts: Opts = {}) {
  const stamp = key === 'settings' || key === 'unread' || key === 'events' || key === 'habit_logs' || key === 'push_subs' ? {} : { updated_at: nowIso() };
  const apply = () => {
    for (const k of key === 'events' ? (['events', 'unread'] as SliceKey[]) : [key as SliceKey]) {
      store.setRows(k as 'tasks', ((rows: Rows<'tasks'>) => rows.map((r) => (same(r as unknown as Row, match) ? { ...r, ...patch, ...stamp } : r))) as never);
    }
  };
  const keys: SliceKey[] = key === 'events' ? ['events', 'unread'] : [key];
  return mutate(keys, apply, () => getClient().update(TABLE[key], match, patch), opts);
}

export function insertRow<K extends SliceKey>(key: K, row: Row, opts: Opts = {}) {
  return mutate(
    [key],
    () => store.setRows(key as 'tasks', ((rows: Rows<'tasks'>) => [...rows, row as never]) as never),
    () => getClient().insert(TABLE[key], row),
    { dupOk: true, ...opts },
  );
}

export function deleteRow<K extends SliceKey>(key: K, match: Row, opts: Opts = {}) {
  return mutate(
    [key],
    () => store.setRows(key as 'tasks', ((rows: Rows<'tasks'>) => rows.filter((r) => !same(r as unknown as Row, match))) as never),
    () => getClient().remove(TABLE[key], match),
    opts,
  );
}

/**
 * Upsert on `pk` (one column, or several joined by commas). `local` is what the screen shows when the row is new;
 * only `row` is sent, so the database keeps every column the write does not name (QA r1 D5).
 */
export function upsertRow<K extends SliceKey>(key: K, row: Row, pk: string, opts: Opts = {}, local: Row = row) {
  const cols = pk.split(',');
  const hit = (r: Row) => cols.every((c) => r[c] === row[c]);
  return mutate(
    [key],
    () =>
      store.setRows(key as 'tasks', ((rows: Rows<'tasks'>) => {
        const i = rows.findIndex((r) => hit(r as unknown as Row));
        if (i < 0) return [...rows, { ...local, ...row } as never];
        return rows.map((r, j) => (j === i ? { ...r, ...row } : r));
      }) as never),
    () => getClient().upsert(TABLE[key], row, pk),
    opts,
  );
}

/** The fields of `after` that differ from `before`, compared as JSON (QA r1 D15: a sheet sends only what changed). */
export function changedFields<T extends Row>(before: T, after: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(after) as (keyof T)[]) {
    if (JSON.stringify(after[k] ?? null) !== JSON.stringify(before[k] ?? null)) out[k] = after[k];
  }
  return out;
}

/** Save a task sheet: only the changed fields, so an edit made elsewhere in the meantime survives. False when nothing changed. */
export function saveTaskEdits(id: string, before: Partial<Task>, after: Partial<Task>, extra: Partial<Task> = {}) {
  const patch = changedFields(before as Row, after as Row);
  if (Object.keys(patch).length === 0) return Promise.resolve(false);
  return patchRow('tasks', { id }, { ...patch, ...extra }, { ok: 'Saved' });
}

// ------------------------------------------------------------------ tasks
/**
 * Add a task. The toast says where it went (QA r2 C36, P04): `Added: Call Sam, Tomorrow 15:00`, or `Added to Tasks: Call Sam`
 * when it has no date, with a Today button that puts it on today's sheet. `opts.quiet` leaves the toast to the caller.
 */
export async function addTask(p: Parsed, extra: Partial<Task> = {}, opts: { quiet?: boolean } = {}) {
  const t: Task = {
    id: uuid(), title: p.title, notes: null, area: p.area, status: 'open', due_date: p.due_date, due_time: p.due_time,
    planned_for: null, priority: p.priority, est_minutes: p.est_minutes, project: p.project, source: 'user', source_ref: null,
    waiting_on: null, next_action: null, cost_usd: null, sort_order: 0, completed_at: null, created_at: nowIso(), updated_at: nowIso(),
    ...extra,
  };
  const ok = await insertRow('tasks', t as unknown as Row);
  if (ok && !opts.quiet) {
    const today = todayIst();
    const due = t.due_date ? `${formatDue(t.due_date, today).text}${t.due_time ? ` ${t.due_time.slice(0, 5)}` : ''}` : '';
    const onToday = t.planned_for === today || t.due_date === today;
    const google = t.due_date && t.due_time ? ` ${calendarWord(store.get('calendar_state').rows[0]?.linked ?? false)}` : '';
    toast(due ? `Added: ${t.title}, ${due}.${google}` : `Added to Tasks: ${t.title}`, 'ok', onToday ? undefined : { label: 'Today', run: () => void planTask(t.id, today) });
  }
  return ok;
}
export const setTaskDone = (id: string, done: boolean, extra: Partial<Task> = {}) =>
  patchRow('tasks', { id }, done ? { status: 'done', completed_at: nowIso(), ...extra } : { status: 'open', completed_at: null, ...extra });

/** Done with a 5 s "Done. Undo" toast (QA r1 F05). Undo reopens the task as it was. Its Claude request closes with it (QA r2 P06). */
export async function completeTask(t: Task, extra: Partial<Task> = {}, text = `Done: ${t.title}`) {
  const ok = await setTaskDone(t.id, true, extra);
  if (ok) {
    const back: Partial<Task> = 'notes' in extra ? { notes: t.notes } : {};
    undoToast(text, () => void setTaskDone(t.id, false, back));
    void closeClaudeForTask(t.id, 'done');
  }
  return ok;
}
/** Drop with a 5 s "Dropped. Undo" toast. */
export async function dropTask(id: string) {
  const ok = await patchRow('tasks', { id }, { status: 'dropped' });
  if (ok) {
    undoToast('Dropped', () => void patchRow('tasks', { id }, { status: 'open' }));
    void closeClaudeForTask(id, 'dropped');
  }
  return ok;
}
export const reopenTask = (id: string) => patchRow('tasks', { id }, { status: 'open', completed_at: null }, { ok: 'Saved' });

/**
 * The saved pick order of one day (`os_days.top_task_ids`). Changed only while the day rows are loaded and fresh, so a write
 * never replaces an order it has not seen (the same rule as the plan line, QA r1 D5).
 */
function writePickOrder(day: string, change: (ids: string[]) => string[]) {
  const days = store.get('days');
  if (days.status !== 'ready' || days.stale || !isOnline()) return Promise.resolve(false);
  const cur = days.rows.find((d) => d.day === day)?.top_task_ids ?? [];
  const next = change(cur);
  if (next.length === cur.length && next.every((x, i) => x === cur[i])) return Promise.resolve(true);
  return saveDay(day, { top_task_ids: next });
}

/**
 * Put a task on a day (or take it off with null). A pick goes last in that day's pick order. A leftover moved on from
 * Close today (`pick: false`) stays out of the order, so it follows every task he chose himself (QA r3 P01). A timed task
 * due today that moves to a later day keeps its time and moves its due date too, so it does not come back untimed (QA r2 P13).
 */
export async function planTask(id: string, day: string | null, { pick = true }: { pick?: boolean } = {}) {
  const t = store.get('tasks').rows.find((x) => x.id === id);
  const before = t?.planned_for ?? null;
  const patch: Row = { planned_for: day };
  if (day && t?.due_time && t.due_date === todayIst() && day > t.due_date) patch.due_date = day;
  const ok = await patchRow('tasks', { id }, patch);
  if (ok) {
    if (before && before !== day) void writePickOrder(before, (ids) => ids.filter((x) => x !== id));
    if (day && pick) void writePickOrder(day, (ids) => (ids.includes(id) ? ids : [...ids, id]));
  }
  return ok;
}
/**
 * Move a task to a day from a row, with the same Undo every other tick has (R4P09). Undo puts its day, its date and both
 * saved orders back as they were.
 */
export async function moveTask(id: string, day: string, opts: { pick?: boolean } = {}) {
  const t = store.get('tasks').rows.find((x) => x.id === id);
  if (!t) return false;
  const orderOf = (d: string | null) => (d ? store.get('days').rows.find((x) => x.day === d)?.top_task_ids ?? [] : []);
  const was = { planned_for: t.planned_for, due_date: t.due_date };
  const orders = [was.planned_for, day].filter((d): d is string => !!d).map((d) => [d, orderOf(d)] as const);
  const ok = await planTask(id, day, opts);
  if (ok) {
    undoToast(`Moved to ${day === todayIst() ? 'today' : day === tomorrowIst() ? 'tomorrow' : formatDue(day, todayIst()).text}: ${t.title}`, () => {
      void patchRow('tasks', { id }, was);
      for (const [d, ids] of orders) void writePickOrder(d, () => [...ids]);
    });
  }
  return ok;
}
/** Move a pick up one place. `ordered` is the day's picks as the screen shows them. */
export function movePickUp(day: string, ordered: string[], id: string) {
  const i = ordered.indexOf(id);
  if (i <= 0) return Promise.resolve(false);
  const next = [...ordered];
  [next[i - 1], next[i]] = [next[i], next[i - 1]];
  return saveDay(day, { top_task_ids: next });
}

/**
 * Rewrite today's order from the war room (logs/qa-r4-plan.md). `queue` is what the plan shows, so the whole order is saved
 * at once. Undo puts the old order back.
 */
export async function reorderPlan(day: string, queue: string[], id: string, where: 'first' | 'last') {
  const before = store.get('days').rows.find((d) => d.day === day)?.top_task_ids ?? [];
  const rest = queue.filter((x) => x !== id);
  const title = store.get('tasks').rows.find((t) => t.id === id)?.title ?? '';
  const ok = await writePickOrder(day, () => (where === 'first' ? [id, ...rest] : [...rest, id]));
  if (ok) undoToast(where === 'first' ? `Moved to the top: ${title}` : 'Moved to the end of today', () => void writePickOrder(day, () => before));
  return ok;
}

/** Today's skip list (`os_settings.plan_skip`, logs/qa-r4-plan.md call E). An old day counts as empty. */
export type DaySkip = { day: string; ids: string[]; more: number };
export const readSkip = (value: unknown, today: string): DaySkip => {
  const v = value as Partial<DaySkip> | null | undefined;
  return v?.day === today ? { day: today, ids: v.ids ?? [], more: v.more ?? 0 } : { day: today, ids: [], more: 0 };
};
const skipNow = (today: string) => readSkip(settingValue<unknown>('plan_skip', null), today);
const saveSkip = (s: DaySkip) => setSetting('plan_skip', s, { quiet: false });

/** Off the plan for today, with Undo: a suggestion, a habit, the evening step, or an event that finished early. */
export async function skipToday(today: string, id: string, text: string) {
  const was = skipNow(today);
  const ok = await saveSkip({ ...was, ids: [...was.ids, id] });
  if (ok) undoToast(text, () => { const cur = skipNow(today); void saveSkip({ ...cur, ids: cur.ids.filter((x) => x !== id) }); });
  return ok;
}

/** After the day's three: one more task, please (call F). */
export function oneMore(today: string) {
  const was = skipNow(today);
  return saveSkip({ ...was, more: was.more + 1 });
}

/** Delete a task. The database empties `task_id` on its reminders and Claude requests, so the cached rows do the same (QA r2 D15). */
export async function deleteTask(id: string) {
  const ok = await deleteRow('tasks', { id }, { ok: 'Deleted' });
  if (ok) {
    store.setRows('reminders', (rows) => rows.map((r) => (r.task_id === id ? { ...r, task_id: null } : r)));
    store.setRows('claude', (rows) => rows.map((r) => (r.task_id === id ? { ...r, task_id: null } : r)));
  }
  return ok;
}

/** Followed up: done, with the date appended to notes (PRD 4 Follow-ups). Undo puts the notes back. */
export function followedUp(t: Task, today: string) {
  const line = `Followed up ${today}`;
  const notes = t.notes ? `${t.notes}\n${line}` : line;
  return completeTask(t, { notes });
}

// ------------------------------------------------------------------- days
/** Send only `{day, ...patch}`, so a mood tap never blanks the plan or review saved elsewhere (QA r1 D5). */
export function saveDay(day: string, patch: Partial<Day>) {
  const local = { day, plan: null, review: null, top_task_ids: [], mood: null };
  return upsertRow('days', { ...patch, day } as unknown as Row, 'day', { quiet: false }, local);
}

// ----------------------------------------------------------------- habits
/** A tick upserts on (habit_id, day), so a retried tick never fails on its own first write (QA r1 D4). */
export function toggleHabitDay(habitId: string, day: string, on: boolean) {
  if (on) {
    const row: HabitLog = { habit_id: habitId, day, done: true, note: null, created_at: nowIso() };
    return upsertRow('habit_logs', row as unknown as Row, 'habit_id,day');
  }
  return deleteRow('habit_logs', { habit_id: habitId, day });
}
/** A habit ticked from the day, with the same Undo a task has (R4P09). */
export async function tickHabit(h: Pick<Habit, 'id' | 'name'>, day: string) {
  const ok = await toggleHabitDay(h.id, day, true);
  if (ok) undoToast(`Done: ${h.name}`, () => void toggleHabitDay(h.id, day, false));
  return ok;
}
export function saveHabit(h: Partial<Habit> & { name: string }) {
  if (h.id) return patchRow('habits', { id: h.id }, h as Row, { ok: 'Saved' });
  const order = Math.max(-1, ...store.get('habits').rows.map((x) => x.sort_order)) + 1;
  const row: Habit = {
    id: uuid(), area: 'personal', days: [0, 1, 2, 3, 4, 5, 6], time_local: null, active: true, sort_order: order,
    created_at: nowIso(), ...h,
  };
  return insertRow('habits', row as unknown as Row, { ok: 'Saved' });
}
export async function moveHabit(id: string, dir: -1 | 1) {
  const list = [...store.get('habits').rows].filter((h) => h.active).sort((a, b) => a.sort_order - b.sort_order);
  const i = list.findIndex((h) => h.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  const a = list[i];
  const b = list[j];
  await Promise.all([
    patchRow('habits', { id: a.id }, { sort_order: b.sort_order }, { quiet: true }),
    patchRow('habits', { id: b.id }, { sort_order: a.sort_order }, { quiet: true }),
  ]);
}

// -------------------------------------------------------------- reminders
export function saveReminder(r: Partial<Reminder> & { title: string }) {
  if (r.id) return patchRow('reminders', { id: r.id }, r as Row, { ok: 'Saved' });
  const row: Reminder = {
    id: uuid(), notes: null, area: 'personal', remind_at: null, time_local: null, repeat: 'none', repeat_days: [], active: true,
    last_fired_at: null, task_id: null, snooze_of: null, created_at: nowIso(), updated_at: nowIso(), ...r,
  };
  return insertRow('reminders', row as unknown as Row, { ok: 'Saved' });
}
export const deleteReminder = (id: string) => deleteRow('reminders', { id }, { ok: 'Deleted' });

/**
 * Done on a reminder: the banner's Done, or the tick on its row. The sheet strikes a reminder only then, never just because it
 * rang (QA r2 P16). `os_settings.reminders_done` maps a reminder id to the IST day it was ticked; older days drop out.
 */
export function reminderDone(r: Reminder, on = true) {
  const today = todayIst();
  const was = settingValue<Record<string, string>>('reminders_done', {});
  const next = Object.fromEntries(Object.entries(was).filter(([id, day]) => day === today && id !== r.id));
  if (on) next[r.id] = today;
  return setSetting('reminders_done', next);
}
/** A reminder ticked from the day, with Undo: it had no way back on any screen (R4P09). */
export async function tickReminder(r: Reminder) {
  const ok = await reminderDone(r);
  if (ok) undoToast(`Done: ${r.title}`, () => void reminderDone(r, false));
  return ok;
}

/**
 * Fired banner, In 10 min: a one-off moves itself; a repeating one gets a one-off copy tagged `snooze_of`, so its schedule
 * stays. The watcher deletes the copy after it has rung (QA r2 P10).
 */
export function snoozeReminder(r: Reminder) {
  const at = new Date(nowMs() + 10 * 60_000).toISOString();
  if (r.repeat === 'none') {
    const ticked = settingValue<Record<string, string>>('reminders_done', {})[r.id] === todayIst();
    const move = () => patchRow('reminders', { id: r.id }, { remind_at: at, active: true }, { ok: 'Again in 10 min' });
    return ticked ? reminderDone(r, false).then(move) : move();
  }
  return saveReminder({ title: r.title, notes: r.notes, area: r.area, remind_at: at, repeat: 'none', task_id: r.task_id, snooze_of: r.id }).then((ok) => {
    if (ok) toast('Again in 10 min');
    return ok;
  });
}

// ------------------------------------------------------------------ events
export function markRead(ids: string[]) {
  if (!ids.length) return Promise.resolve(true);
  return patchRow('events', { id: ids }, { read_at: nowIso() }, { quiet: false });
}

// ------------------------------------------------------------------- notes
export function saveNote(n: Partial<Note> & { title: string; body: string }, area: Area) {
  if (n.id) return patchRow('notes', { id: n.id }, n as Row, { ok: 'Saved' });
  const row: Note = { id: uuid(), area, pinned: false, created_at: nowIso(), updated_at: nowIso(), ...n };
  return insertRow('notes', row as unknown as Row, { ok: 'Saved' });
}
export const pinNote = (id: string, pinned: boolean) => patchRow('notes', { id }, { pinned });
export const deleteNote = (id: string) => deleteRow('notes', { id }, { ok: 'Deleted' });

// ----------------------------------------------------------------- finance
export function saveEntry(e: Partial<FinanceEntry> & { label: string; amount: number }, kind: 'cost' | 'revenue', month: string) {
  if (e.id) return patchRow('finance', { id: e.id }, e as Row, { ok: 'Saved' });
  const row: FinanceEntry = {
    id: uuid(), kind, currency: 'USD', recurrence: 'one_time', month, end_month: null, source: 'manual', source_ref: null,
    notes: null, created_at: nowIso(), updated_at: nowIso(), ...e,
  };
  return insertRow('finance', row as unknown as Row, { ok: 'Saved' });
}
export const deleteEntry = (id: string) => deleteRow('finance', { id }, { ok: 'Deleted' });

// ---------------------------------------------------------------- settings
export function setSetting(key: string, value: unknown, opts: Opts = { quiet: true }) {
  return upsertRow('settings', { key, value, updated_at: nowIso() }, 'key', opts);
}

export function settingValue<T>(key: string, fallback: T): T {
  const row = store.get('settings').rows.find((r) => r.key === key);
  return row ? (row.value as T) : fallback;
}

/** What a timed task says about Google, in the add preview, the toast and the task sheet (R4P10, R4P13). */
export const calendarWord = (linked: boolean) => (linked ? 'Goes on Google Calendar.' : 'Stays off Google until the calendar is linked.');

export const todayIst = () => istDate(nowMs());
export const tomorrowIst = () => addDays(istDate(nowMs()), 1);
export type { OsEvent };
