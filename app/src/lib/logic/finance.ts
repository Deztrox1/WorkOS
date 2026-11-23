import { addMonths } from '../../shared/ist';
import type { FinanceEntry } from '../types';

export type Fx = Record<string, number>; // USD per 1 unit of currency
export const DEFAULT_FX: Fx = { USD: 1, INR: 1 / 84, GBP: 1.3 };

export const toUsd = (amount: number, currency: string, fx: Fx) => amount * (fx[currency] ?? 1);

/** Entries that apply to a month (first day 'YYYY-MM-01'). Monthly entries run from month to end_month. */
export function entriesFor(entries: FinanceEntry[], month: string, kind: 'cost' | 'revenue'): FinanceEntry[] {
  return entries.filter((e) => {
    if (e.kind !== kind) return false;
    if (e.recurrence === 'one_time') return e.month === month;
    return e.month <= month && (!e.end_month || e.end_month >= month);
  });
}

/** A ledger invoice counts as revenue only when it is paid or sent. Drafts do not. Manual rows have no status and count. */
export const isDraft = (e: FinanceEntry) => e.kind === 'revenue' && e.source === 'ledger' && !['paid', 'sent'].includes(e.notes ?? 'sent');
export const counted = (list: FinanceEntry[]) => list.filter((e) => !isDraft(e));

export function totalUsd(list: FinanceEntry[], fx: Fx): number {
  return list.reduce((s, e) => s + toUsd(Number(e.amount), e.currency, fx), 0);
}

export type MonthSummary = { month: string; revenue: number; costs: number; profit: number };

export function summarize(entries: FinanceEntry[], month: string, fx: Fx): MonthSummary {
  const revenue = totalUsd(counted(entriesFor(entries, month, 'revenue')), fx);
  const costs = totalUsd(entriesFor(entries, month, 'cost'), fx);
  return { month, revenue, costs, profit: revenue - costs };
}

/** 12 months ending at the picked month, oldest first. */
export function twelveMonths(entries: FinanceEntry[], endMonth: string, fx: Fx): MonthSummary[] {
  return Array.from({ length: 12 }, (_, i) => summarize(entries, addMonths(endMonth, i - 11), fx));
}

/** Round to cents to hide float noise (840 INR at 1/84 is exactly 10). */
export const cents = (n: number) => Math.round(n * 100) / 100;

/** Round y-axis ticks covering [min, max] in at most 4 ticks (3 steps), always including 0 when min <= 0 <= max. */
export function niceTicks(min: number, max: number): number[] {
  const lo = Math.min(0, min), hi = Math.max(0, max, 1);
  const raw = (hi - lo) / 3;
  const base = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * base).find((s) => Math.ceil(hi / s) - Math.floor(lo / s) <= 3) ?? 10 * base;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step + step / 1e6; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}
