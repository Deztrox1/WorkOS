import { useMemo } from 'react';
import { useToday } from './clock';
import { lastSendDay } from './logic/campaigns';
import { byPickOrder } from './logic/tasks';
import { buildSheet, claudeOnToday, workFlags, type SheetHabit, type SheetReminder } from './logic/today';
import { readSkip } from './actions';
import { store, useSlice } from './store';
import { inFlight, type Balance, type ClaudeRequest } from './types';
import { addDays, istDate, istParts, weekdayOf } from '../shared/ist';

/**
 * Everything the war room and the evening screen read about the day, for both areas at once (logs/qa-r4-plan.md decision 9).
 * Tasks, reminders, alerts and habits from Work and Personal share one sheet. `closing` is the evening screen: before 05:00
 * the day just ended is still its today, and tomorrow is the coming morning (R4Y06).
 */
export function useDay(closing = false) {
  const clockDay = useToday();
  const now = Date.now();
  const today = closing && istParts(now).hh < 5 ? addDays(clockDay, -1) : clockDay;
  const tasks = useSlice('tasks');
  const reminders = useSlice('reminders');
  const days = useSlice('days');
  const habits = useSlice('habits');
  const logs = useSlice('habit_logs');
  const unread = useSlice('unread');
  const campaigns = useSlice('campaigns');
  const snaps = useSlice('snapshots');
  const settings = useSlice('settings');
  const claude = useSlice('claude');
  const retry = () => void store.refresh(['tasks', 'reminders', 'days', 'habits', 'habit_logs', 'unread', 'campaigns', 'snapshots', 'claude', 'calendar', 'calendar_state']);

  const tomorrow = addDays(today, 1);
  const open = useMemo(() => tasks.rows.filter((t) => t.status === 'open'), [tasks.rows]);
  // Finished today stays on the sheet, struck, until the day ends (QA r2 P08).
  const doneToday = useMemo(
    () => tasks.rows.filter((t) => t.status === 'done' && istDate(new Date(t.completed_at ?? t.updated_at).getTime()) === today),
    [tasks.rows, today],
  );
  const todaysHabits = useMemo(() => habits.rows.filter((h) => h.active && h.days.includes(weekdayOf(today))), [habits.rows, today]);
  const habitDone = useMemo(() => new Set(logs.rows.filter((l) => l.day === today && l.done).map((l) => l.habit_id)), [logs.rows, today]);
  const balances = (settings.rows.find((r) => r.key === 'balances')?.value ?? {}) as Record<string, Balance>;
  const limits = (settings.rows.find((r) => r.key === 'balance_limits')?.value ?? {}) as Record<string, number>;
  const flagsSeen = (settings.rows.find((r) => r.key === 'flags_seen')?.value ?? {}) as Record<string, string>;
  const remindersDone = (settings.rows.find((r) => r.key === 'reminders_done')?.value ?? {}) as Record<string, string>;
  const lastSend = useMemo(() => lastSendDay(snaps.rows), [snaps.rows]);
  // A work exception already seen today stays hidden until tomorrow (QA r2 P09).
  const flags = useMemo(
    () => workFlags(campaigns.rows, balances, limits, lastSend).filter((f) => flagsSeen[f.id] !== today),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [campaigns.rows, settings.rows, lastSend, today],
  );
  const withClaude = useMemo(() => new Set(claude.rows.filter((r) => r.task_id && inFlight(r.status)).map((r) => r.task_id as string)), [claude.rows]);
  const skipValue = settings.rows.find((r) => r.key === 'plan_skip')?.value;
  const planSkip = useMemo(() => readSkip(skipValue, today), [skipValue, today]);
  const dayRow = days.rows.find((d) => d.day === today);
  const pickOrder = dayRow?.top_task_ids ?? [];
  const sheet = useMemo(
    () => buildSheet({ open, doneToday, reminders: reminders.rows, unread: unread.rows, habits: todaysHabits, habitDone, flags, today, nowMs: now, pickOrder, claudeTasks: withClaude, remindersDone }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, doneToday, reminders.rows, unread.rows, todaysHabits, habitDone, flags, today, now, dayRow?.top_task_ids, withClaude, settings.rows],
  );
  const failed = [tasks, reminders, unread].some((x) => x.status === 'error');
  // No data yet: the screen must not claim the day is empty (QA r3 C01).
  const opening = !failed && [tasks, reminders, unread].some((x) => x.status === 'idle' || x.status === 'loading');

  // Claude: a request rides on its task row when that row is on the sheet; otherwise it gets its own row.
  const asks = useMemo(() => claude.rows.filter(claudeOnToday).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)), [claude.rows]);
  const askFor = new Map<string, ClaudeRequest>();
  for (const r of asks) if (r.task_id && !askFor.has(r.task_id)) askFor.set(r.task_id, r);

  const tomorrowOpen = tasks.rows.filter((t) => t.status === 'open' && t.planned_for === tomorrow);
  // Only what the owner picked counts as planned. A task pushed here with Tomorrow never joins this order (R4Y05).
  const tmOrder = days.rows.find((d) => d.day === tomorrow)?.top_task_ids ?? [];
  const tomorrowPicks = tomorrowOpen.filter((t) => tmOrder.includes(t.id));
  const tomorrowFirst = byPickOrder(tomorrowPicks, tmOrder)[0]?.title ?? null;
  // In the small hours the morning's first pick is on today's date.
  const todayFirst = byPickOrder(open.filter((t) => t.planned_for === today), pickOrder)[0]?.title ?? null;
  // Everything ticked today, for the Done fold and the count (R4P09).
  const doneHabits = sheet.today.filter((r): r is SheetHabit => r.kind === 'habit' && r.done);
  const doneReminders = sheet.today.filter((r): r is SheetReminder => r.kind === 'reminder' && r.struck);
  const doneCount = doneToday.length + doneHabits.length + doneReminders.length;

  return {
    today, tomorrow, now, open, doneToday, doneHabits, doneReminders, doneCount, sheet, asks, askFor, withClaude, dayRow, pickOrder, planSkip, flagsSeen, failed, opening, retry,
    tomorrowPicked: tomorrowPicks.length, tomorrowFirst, todayFirst, slices: [tasks, reminders, unread], logs, campaigns, days,
  };
}
