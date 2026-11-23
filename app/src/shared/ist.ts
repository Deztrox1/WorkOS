// IST (Asia/Kolkata) helpers. IST is a fixed +05:30 offset with no DST, so plain integer
// math is exact and works in any runtime (browser, Node, push-due bundle).
export const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

export type IstParts = { y: number; m: number; d: number; hh: number; mm: number; ss: number; dow: number };

export function istParts(ms: number): IstParts {
  const t = new Date(ms + IST_OFFSET_MS);
  return {
    y: t.getUTCFullYear(),
    m: t.getUTCMonth() + 1,
    d: t.getUTCDate(),
    hh: t.getUTCHours(),
    mm: t.getUTCMinutes(),
    ss: t.getUTCSeconds(),
    dow: t.getUTCDay(),
  };
}

const p2 = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' of the IST calendar day containing ms. */
export function istDate(ms: number): string {
  const p = istParts(ms);
  return `${p.y}-${p2(p.m)}-${p2(p.d)}`;
}

/** 'HH:MM' (24 h) in IST. */
export function istTime(ms: number): string {
  const p = istParts(ms);
  return `${p2(p.hh)}:${p2(p.mm)}`;
}

/** Epoch ms for an IST wall clock time. date 'YYYY-MM-DD', time 'HH:MM' or 'HH:MM:SS'. */
export function istToMs(date: string, time = '00:00'): number {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm, ss] = time.split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh || 0, mm || 0, ss || 0) - IST_OFFSET_MS;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())}`;
}

/** Whole days from a to b (b - a), both 'YYYY-MM-DD'. */
export function diffDays(a: string, b: string): number {
  return Math.round((istToMs(b) - istToMs(a)) / DAY_MS);
}

/** 0 = Sunday .. 6 = Saturday, for a 'YYYY-MM-DD' date. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Next IST midnight strictly after ms. */
export function nextIstMidnight(ms: number): number {
  return istToMs(addDays(istDate(ms), 1));
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function addMonths(monthStart: string, n: number): string {
  const [y, m] = monthStart.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-01`;
}
