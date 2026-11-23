import { addDays, diffDays, istDate, istParts, istToMs, weekdayOf } from '../../shared/ist';

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const weekdayShort = (date: string) => WD[weekdayOf(date)];
export const monthShort = (m: number) => MON[m - 1];

/** '20 Oct' */
export function dayMonth(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${d} ${MON[m - 1]}`;
}

/** 'Thu 22 Oct' */
export function longDate(date: string): string {
  return `${weekdayShort(date)} ${dayMonth(date)}`;
}

export function monthLabel(monthStart: string): string {
  const [y, m] = monthStart.split('-').map(Number);
  return `${MON[m - 1]} ${y}`;
}

export type DueText = { text: string; overdue: boolean };

/** PRD 4 Formats: Today, Tomorrow, weekday within 7 days, else '20 Oct'; past due 'from 1 Sep' in plain words (QA r2 C05, C26). */
export function formatDue(due: string, today: string): DueText {
  const diff = diffDays(today, due);
  if (diff < 0) return { text: `from ${dayMonth(due)}`, overdue: true };
  if (diff === 0) return { text: 'Today', overdue: false };
  if (diff === 1) return { text: 'Tomorrow', overdue: false };
  if (diff <= 7) return { text: weekdayShort(due), overdue: false };
  return { text: dayMonth(due), overdue: false };
}

export function money(n: number | null | undefined, currency = 'USD'): string {
  if (n === null || n === undefined) return '';
  const sym = currency === 'USD' ? (n < 0 ? '-$' : '$') : '';
  if (currency === 'USD') n = Math.abs(n);
  const s = n.toLocaleString('en-US', { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
  return currency === 'USD' ? `${sym}${s}` : `${s} ${currency}`;
}

export function usd(n: number): string {
  return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** '$12.50' for task cost (always two decimals). */
export function costText(n: number): string {
  return '$' + n.toFixed(2);
}

export function relTime(iso: string, nowMs: number): string {
  const diff = Math.max(0, nowMs - new Date(iso).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} d ago`;
  return dayMonth(istDate(new Date(iso).getTime()));
}

/** 'Thu 07:45': the weekday and the clock for a moment, in IST. */
export function dayTime(ms: number): string {
  return `${weekdayShort(istDate(ms))} ${timeText(new Date(ms).toISOString())}`;
}

export function timeText(iso: string): string {
  const p = istParts(new Date(iso).getTime());
  return `${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}`;
}

/** 'Tomorrow 15:30', 'Sat 10:00', '30 Nov 08:00' for a fire time. */
export function fireText(ms: number, nowMs: number): string {
  const date = istDate(ms);
  const today = istDate(nowMs);
  const t = timeText(new Date(ms).toISOString());
  const diff = diffDays(today, date);
  if (diff === 0) return `Today ${t}`;
  if (diff === 1) return `Tomorrow ${t}`;
  if (diff > 1 && diff <= 7) return `${weekdayShort(date)} ${t}`;
  return `${dayMonth(date)} ${t}`;
}

export function greeting(nowMs: number): string {
  const hh = istParts(nowMs).hh;
  if (hh < 5 || hh >= 23) return 'Good night';
  return hh < 12 ? 'Good morning' : hh < 18 ? 'Good afternoon' : 'Good evening';
}

export { addDays, istToMs };

const VENDORS: Record<string, string> = {
  consulti: 'Consulti', millionverifier: 'MillionVerifier', numlookup: 'NumLookup', anymailfinder: 'AnyMailFinder',
  instantly: 'Instantly', winnr: 'Winnr', apify: 'Apify', firecrawl: 'Firecrawl', openrouter: 'OpenRouter', anthropic: 'Anthropic',
};
/** A balance key as people say it: 'millionverifier' reads 'MillionVerifier'. Unknown keys get a capital first letter. */
export function vendorLabel(slug: string): string {
  return VENDORS[slug.toLowerCase()] ?? slug.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}
