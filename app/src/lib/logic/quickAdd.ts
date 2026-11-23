import * as chrono from 'chrono-node';
import { addDays, istDate, istParts } from '../../shared/ist';
import type { Area } from '../types';

export type Parsed = {
  title: string;
  due_date: string | null;
  due_time: string | null;
  est_minutes: number | null;
  project: string | null;
  priority: number;
  area: Area;
};

const IST_MIN = 330;
/** The hours a bare "at 5" can mean. */
const DAY_FROM = 7;
const DAY_TO = 22;
const p2 = (n: number) => String(n).padStart(2, '0');

/**
 * Quick add parser (PRD 5.4). Forward-looking dates via chrono-node in IST.
 * Date only leaves time null. Time only means today if still ahead, else tomorrow.
 * Trailing 20m / 1h / 45 min sets minutes. #word sets project. ! = priority 1, !low = 3.
 */
export function parseQuickAdd(input: string, nowMs: number, area: Area): Parsed {
  let text = ` ${input.trim()} `;
  let priority = 2;
  let project: string | null = null;
  let est: number | null = null;

  text = text.replace(/\s!low(?=\s)/i, () => {
    priority = 3;
    return ' ';
  });
  text = text.replace(/\s!(?=\s)/, () => {
    if (priority === 2) priority = 1;
    return ' ';
  });
  text = text.replace(/\s#([\w-]+)(?=\s)/, (_m, w: string) => {
    project = w.toLowerCase();
    return ' ';
  });
  const length = (n: string, u: string) => (/^h/i.test(u) ? Math.round(parseFloat(n) * 60) : Math.round(parseFloat(n)));
  // "call Sam in 2 hours" is a time, not a length, so it stays for the date parser (R4P15).
  text = text.replace(/(\sin)?\s(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)(?=\s*$)/i, (m, inWord: string | undefined, n: string, u: string) => {
    if (inWord) return m;
    est = length(n, u);
    return ' ';
  });
  // A length can lead too: "15 min call with Sam at 6pm".
  if (est === null) {
    text = text.replace(/^\s(\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?)\s(?=\S)/i, (_m, n: string, u: string) => {
      est = length(n, u);
      return ' ';
    });
  }

  let due_date: string | null = null;
  let due_time: string | null = null;
  const body = text.trim();
  let title = body;

  const results = chrono.parse(body, { instant: new Date(nowMs), timezone: IST_MIN }, { forwardDate: true });
  const hit = results.find((r) => r.start.isCertain('day') || r.start.isCertain('weekday') || r.start.isCertain('hour'));
  if (hit) {
    const s = hit.start;
    const hasDate = s.isCertain('day') || s.isCertain('weekday') || s.isCertain('month');
    const hasTime = s.isCertain('hour');
    const minute = s.get('minute') ?? 0;
    const today = istDate(nowMs);
    const p = istParts(nowMs);
    const nowHm = p.hh * 60 + p.mm;
    const ahead = (h: number) => h * 60 + minute > nowHm;
    // A bare hour ("at 5") means the next daytime hour: nobody books a call at 05:00 by saying "at 5" (R4P15).
    const hour = s.get('hour') ?? 0;
    const bare = hasTime && !s.isCertain('meridiem') && hour >= 1 && hour <= 12;
    const day = (h: number) => h >= DAY_FROM && h <= DAY_TO;
    const options = bare ? [hour, hour === 12 ? 12 : hour + 12].filter(day) : [hour];
    const relative = /^in\s/i.test(hit.text);
    const hh = relative ? hour : hasDate ? options[0] ?? hour : options.find(ahead) ?? options[0] ?? hour;
    if (hasTime) due_time = `${p2(hh)}:${p2(minute)}`;
    if (hasDate) {
      due_date = `${s.get('year')}-${p2(s.get('month') ?? 1)}-${p2(s.get('day') ?? 1)}`;
    } else if (hasTime) {
      // time only: today if still ahead, else tomorrow
      due_date = ahead(hh) ? today : addDays(today, 1);
    }
    const before = body.slice(0, hit.index).replace(/\b(on|at|by|due|before|until|for)\s*$/i, '');
    const after = body.slice(hit.index + hit.text.length);
    title = `${before} ${after}`;
  }
  title = title.replace(/\s+/g, ' ').trim();
  if (!title) title = body;

  return { title, due_date, due_time, est_minutes: est, project, priority, area };
}
