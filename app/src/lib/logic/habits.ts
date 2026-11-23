import { addDays, diffDays, istDate, weekdayOf } from '../../shared/ist';
import type { Habit, HabitLog } from '../types';

export type CellState = 'done' | 'missed' | 'open' | 'off';
export type Cell = { day: string; state: CellState };

export const scheduled = (h: Pick<Habit, 'days'>, day: string) => h.days.includes(weekdayOf(day));

function doneSet(logs: HabitLog[]): Set<string> {
  return new Set(logs.filter((l) => l.done).map((l) => l.day));
}

/** PRD 5.6 strip: done, missed (scheduled, on/after created_at, before today, no row), open (today, no row), off. */
export function strip(h: Habit, logs: HabitLog[], today: string, n = 14): Cell[] {
  const done = doneSet(logs);
  const created = istDate(new Date(h.created_at).getTime());
  const out: Cell[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const day = addDays(today, -i);
    let state: CellState;
    if (done.has(day)) state = 'done';
    else if (!scheduled(h, day)) state = 'off';
    else if (day === today) state = 'open';
    else if (day >= created && day < today) state = 'missed';
    else state = 'off';
    out.push({ day, state });
  }
  return out;
}

/** Consecutive scheduled days done, ending today; an open today does not break it. Off days are skipped, never counted. */
export function currentStreak(h: Habit, logs: HabitLog[], today: string): number {
  const done = doneSet(logs);
  let streak = 0;
  let day = today;
  for (let guard = 0; guard < 800; guard++) {
    if (scheduled(h, day)) {
      if (done.has(day)) streak++;
      else if (day !== today) break;
    }
    // an off day neither adds to nor breaks the streak, and a log on it never counts
    day = addDays(day, -1);
  }
  return streak;
}

export function bestStreak(h: Habit, logs: HabitLog[], today: string): number {
  const done = doneSet(logs);
  if (done.size === 0) return 0;
  const first = [...done].sort()[0];
  const created = istDate(new Date(h.created_at).getTime());
  const start = first < created ? first : created;
  let best = 0;
  let run = 0;
  const span = diffDays(start, today);
  for (let i = 0; i <= span; i++) {
    const day = addDays(start, i);
    if (scheduled(h, day) && done.has(day)) {
      run++;
      if (run > best) best = run;
    } else if (scheduled(h, day) && day !== today) {
      run = 0;
    }
  }
  return best;
}
