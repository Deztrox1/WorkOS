import { addDays, diffDays, istDate } from '../../shared/ist';
import type { Task } from '../types';
import { costText, formatDue } from './format';

const cmpNullLast = <T extends string | number>(a: T | null, b: T | null) => {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
};

/** PRD 4 Task sort: due_date (nulls last), due_time (nulls last), priority, sort_order. */
export function sortTasks<T extends Task>(tasks: T[]): T[] {
  return [...tasks].sort(
    (a, b) =>
      cmpNullLast(a.due_date, b.due_date) ||
      cmpNullLast(a.due_time, b.due_time) ||
      a.priority - b.priority ||
      a.sort_order - b.sort_order ||
      a.title.localeCompare(b.title),
  );
}

export type GroupKey = 'overdue' | 'today' | 'tomorrow' | 'next14' | 'upcoming' | 'later' | 'nodate';
export type Group = { key: GroupKey; label: string; tasks: Task[] };

export function groupKey(due: string | null, today: string, mergeTomorrow: boolean): GroupKey {
  if (!due) return 'nodate';
  const d = diffDays(today, due);
  if (d < 0) return 'overdue';
  if (d === 0) return 'today';
  if (d === 1) return mergeTomorrow ? 'upcoming' : 'tomorrow';
  if (d <= 14) return mergeTomorrow ? 'upcoming' : 'next14';
  return 'later';
}

const LABELS: Record<GroupKey, string> = {
  overdue: 'Earlier',
  today: 'Today',
  tomorrow: 'Tomorrow',
  next14: 'Next 14 days',
  upcoming: 'Upcoming',
  later: 'Later',
  nodate: 'No date',
};

/** PRD 4 Task grouping. Each open task lands in exactly one group. Empty groups are dropped. */
export function groupTasks(open: Task[], today: string, mergeTomorrow: boolean): Group[] {
  const order: GroupKey[] = mergeTomorrow
    ? ['overdue', 'today', 'upcoming', 'later', 'nodate']
    : ['overdue', 'today', 'tomorrow', 'next14', 'later', 'nodate'];
  const buckets = new Map<GroupKey, Task[]>(order.map((k) => [k, []]));
  for (const t of open) buckets.get(groupKey(t.due_date, today, mergeTomorrow))!.push(t);
  return order
    .map((k) => ({ key: k, label: LABELS[k], tasks: sortTasks(buckets.get(k)!) }))
    .filter((g) => g.tasks.length > 0);
}

/** Done = status done or dropped with updated_at in the last 30 days, newest first. */
export function doneTasks(all: Task[], nowMs: number): Task[] {
  const cutoff = nowMs - 30 * 86_400_000;
  return all
    .filter((t) => (t.status === 'done' || t.status === 'dropped') && new Date(t.updated_at).getTime() >= cutoff)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
}

export function isFollowUp(t: Task): boolean {
  return t.project === 'sales' && t.due_date !== null;
}

export function idleDays(t: Task, nowMs: number): number | null {
  const d = Math.floor((nowMs - new Date(t.updated_at).getTime()) / 86_400_000);
  return d >= 7 ? d : null;
}

/** One plain line (QA r2 C25, P17): the next step, or who it waits on. Both stay in full in the task sheet. */
export function taskLine2(t: Task): string | null {
  if (t.next_action) return `Next: ${t.next_action}`;
  if (t.waiting_on) return `Waiting on ${t.waiting_on}`;
  return null;
}

/**
 * Tasks in the order the owner picked them (`os_days.top_task_ids`): the picks first, in that order, then the rest in the
 * usual sort (QA r2 P03). An id that is no longer in `tasks` is ignored.
 */
export function byPickOrder<T extends Task>(tasks: T[], ids: readonly string[] | null | undefined): T[] {
  const at = new Map((ids ?? []).map((id, i) => [id, i]));
  const picked = tasks.filter((t) => at.has(t.id)).sort((a, b) => at.get(a.id)! - at.get(b.id)!);
  return [...picked, ...sortTasks(tasks.filter((t) => !at.has(t.id)))];
}

export type Line3 = { text: string; overdue: boolean; due: string };

/** PRD 4 Task row line 3: due · est minutes · project · cost. The idle count stays in the data: on a row it read as blame (R4P35). */
export function taskLine3(t: Task, today: string): Line3 {
  const parts: string[] = [];
  let overdue = false;
  let due = '';
  if (t.due_date) {
    const f = formatDue(t.due_date, today);
    overdue = f.overdue;
    due = f.text + (t.due_time ? ` ${t.due_time.slice(0, 5)}` : '');
    parts.push(due);
  }
  if (t.est_minutes) parts.push(`${t.est_minutes} min`);
  if (t.project) parts.push(t.project);
  if (t.cost_usd !== null && t.cost_usd !== undefined) parts.push(costText(Number(t.cost_usd)));
  return { text: parts.join(' · '), overdue, due };
}

export const sumMinutes = (ts: Task[]) => ts.reduce((s, t) => s + (t.est_minutes ?? 0), 0);

export type TodayList = { rows: Task[]; more: number };

/**
 * Today "To do" (PRD 5.2): open tasks planned for today first, then at most 3 overdue ones (oldest due_date,
 * planned_for null or today), 5 rows in all. A task planned for a later day is hidden. `more` counts what did not fit.
 */
export function todayList(open: Task[], today: string, limit = 5, overdueCap = 3): TodayList {
  const planned = sortTasks(open.filter((t) => t.planned_for === today));
  const overdue = open
    .filter((t) => t.due_date !== null && t.due_date < today && t.planned_for === null)
    .sort((a, b) => (a.due_date! < b.due_date! ? -1 : a.due_date! > b.due_date! ? 1 : a.sort_order - b.sort_order));
  const room = Math.max(0, limit - planned.length);
  const rows = [...planned.slice(0, limit), ...overdue.slice(0, Math.min(overdueCap, room))];
  return { rows, more: planned.length + overdue.length - rows.length };
}

export function matchesSearch(t: Task, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return [t.title, t.notes, t.project, t.waiting_on].some((v) => (v ?? '').toLowerCase().includes(s));
}

export function tomorrowOf(today: string): string {
  return addDays(today, 1);
}

export { istDate };
