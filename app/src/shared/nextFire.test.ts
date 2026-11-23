import { describe, expect, it } from 'vitest';
import fixture from '../../../shared/next_fire_cases.json';
import { monthlyAnchor, nextFire, neverFires, type ReminderLike } from './nextFire';

type Case = { name: string; reminder: ReminderLike; now: string; expected: string | null };

describe('nextFire against the shared fixture (RM-02 to RM-05, RM-17, RM-22, RM-23)', () => {
  for (const c of fixture.cases as Case[]) {
    it(c.name, () => {
      const got = nextFire(c.reminder, new Date(c.now).getTime());
      expect(got === null ? null : got).toBe(c.expected === null ? null : new Date(c.expected).getTime());
    });
  }
  it('covers all six repeat types and a month-end clamp', () => {
    const kinds = new Set((fixture.cases as Case[]).map((c) => c.reminder.repeat));
    expect([...kinds].sort()).toEqual(['custom', 'daily', 'monthly', 'none', 'weekdays', 'weekly']);
  });
  it('RM-23 a day-31 monthly reminder made on 1 Nov fires 30 Nov, not 31 Dec', () => {
    const now = new Date('2026-11-01T10:00:00+05:30').getTime();
    const anchor = monthlyAnchor(31, now, '08:00');
    expect(new Date(anchor).toISOString()).toBe(new Date('2026-10-31T08:00:00+05:30').toISOString());
    const f = nextFire({ repeat: 'monthly', time_local: '08:00', remind_at: new Date(anchor).toISOString() }, now);
    expect(f).toBe(new Date('2026-11-30T08:00:00+05:30').getTime());
    // a month that has the day anchors on itself
    expect(new Date(monthlyAnchor(15, now, '09:00')).toISOString()).toBe(new Date('2026-11-15T09:00:00+05:30').toISOString());
  });
  it('neverFires flags dead reminders', () => {
    expect(neverFires({ repeat: 'custom', repeat_days: [] , time_local: '10:00'}, Date.now())).toBe(true);
  });
});
