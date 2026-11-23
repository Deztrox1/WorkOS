// Next fire time for a reminder (PRD 5.5 "Next fire"). One implementation, imported by the app
// and bundled into push-due. Shares shared/next_fire_cases.json with every other port.
import { addDays, daysInMonth, istDate, istParts, istToMs, weekdayOf } from './ist';

export type ReminderLike = {
  repeat: 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'custom';
  remind_at?: string | null; // ISO timestamp
  time_local?: string | null; // 'HH:MM' or 'HH:MM:SS', IST
  repeat_days?: number[] | null; // 0 = Sunday .. 6 = Saturday
};

const SEARCH_DAYS = 400;

function timeOf(r: ReminderLike): string | null {
  if (r.time_local) return r.time_local.slice(0, 5);
  if (r.remind_at) {
    const p = istParts(new Date(r.remind_at).getTime());
    return `${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}`;
  }
  return null;
}

/** Epoch ms of the first fire strictly after nowMs (and not before remind_at), or null if it never fires. */
export function nextFire(r: ReminderLike, nowMs: number): number | null {
  const anchor = r.remind_at ? new Date(r.remind_at).getTime() : null;
  if (anchor !== null && Number.isNaN(anchor)) return null;

  if (r.repeat === 'none') {
    return anchor !== null && anchor > nowMs ? anchor : null;
  }

  const time = timeOf(r);
  if (!time) return null;
  const ok = (ms: number) => ms > nowMs && (anchor === null || ms >= anchor);

  if (r.repeat === 'monthly') {
    if (anchor === null) return null;
    const dom = istParts(anchor).d;
    const start = istParts(Math.max(nowMs, anchor));
    let y = start.y;
    let m = start.m;
    for (let i = 0; i < 30; i++) {
      const day = Math.min(dom, daysInMonth(y, m));
      const ms = istToMs(`${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`, time);
      if (ok(ms)) return ms;
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
    return null;
  }

  let days: Set<number>;
  if (r.repeat === 'daily') days = new Set([0, 1, 2, 3, 4, 5, 6]);
  else if (r.repeat === 'weekdays') days = new Set([1, 2, 3, 4, 5]);
  else {
    const chosen = r.repeat_days ?? [];
    if (chosen.length) days = new Set(chosen);
    else if (r.repeat === 'weekly' && anchor !== null) days = new Set([istParts(anchor).dow]);
    else return null;
  }

  const first = istDate(anchor !== null ? Math.max(nowMs, anchor) : nowMs);
  for (let i = 0; i <= SEARCH_DAYS; i++) {
    const date = addDays(first, i);
    if (!days.has(weekdayOf(date))) continue;
    const ms = istToMs(date, time);
    if (ok(ms)) return ms;
  }
  return null;
}

/** True when a reminder can never fire (used to block Save). */
export function neverFires(r: ReminderLike, nowMs: number): boolean {
  return nextFire(r, nowMs) === null;
}

/**
 * The `remind_at` anchor for a monthly reminder on day-of-month `want` (1 to 31). The anchor only carries the day number,
 * so it is the latest month at or before the current one that really has that day. A day-31 reminder made on 1 Nov
 * anchors on 31 Oct and `nextFire` then clamps to 30 Nov; anchoring on 31 Dec would skip November.
 */
export function monthlyAnchor(want: number, nowMs: number, time: string): number {
  const d = Math.min(31, Math.max(1, Math.round(want) || 1));
  let { y, m } = istParts(nowMs);
  while (daysInMonth(y, m) < d) { m -= 1; if (m < 1) { m = 12; y -= 1; } }
  return istToMs(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, time);
}
