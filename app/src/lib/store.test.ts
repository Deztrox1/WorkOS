import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Query } from './data';

// The store reads localStorage when it loads, and the client is whatever this test hands it.
const local = new Map<string, string>();
const pending: Array<(rows: unknown[]) => void> = [];
const calls: Query[] = [];
vi.mock('./data', () => ({
  getClient: () => ({
    select: (_t: string, q: Query) => { calls.push(q); return new Promise((resolve) => pending.push(resolve)); },
  }),
}));

beforeAll(() => {
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => local.get(k) ?? null, setItem: (k: string, v: string) => void local.set(k, v), removeItem: (k: string) => void local.delete(k),
  };
});

describe('sign-out and the calendar read (QA r4)', () => {
  it('a load in flight when the cache is cleared writes nothing back (R4S15)', async () => {
    const { store } = await import('./store');
    const run = store.load('calendar');
    store.clearCache();
    pending.shift()?.([{ id: 'secret' }]);
    await run;
    expect(store.get('calendar').rows).toEqual([]);
    expect([...local.keys()].filter((k) => k.endsWith('calendar'))).toEqual([]);
  });
  it('a load after the clear works as usual', async () => {
    const { store } = await import('./store');
    const run = store.load('calendar');
    pending.shift()?.([{ id: 'fresh' }]);
    await run;
    expect(store.get('calendar').rows).toEqual([{ id: 'fresh' }]);
  });
  it('the calendar read has an upper end on both branches (R4S13, R4B17)', () => {
    const [timed, allDay] = calls.at(-1)?.any as unknown as [unknown[][], unknown[][]];
    expect(timed.map((f) => f.slice(0, 2))).toEqual([['ends_at', 'gte'], ['starts_at', 'lt']]); // by its end, so a 3-day event gets through (R4X11)
    expect(allDay.map((f) => f.slice(0, 2))).toEqual([['all_day_to', 'gte'], ['all_day_from', 'lte']]);
  });
});
