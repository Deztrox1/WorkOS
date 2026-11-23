import { describe, expect, it } from 'vitest';
import type { Campaign, Snapshot } from '../types';
import { campaignDelta, delta24, type BaselineRow } from './campaigns';

const NOW = new Date('2026-10-21T10:00:00+05:30').getTime();
const camp = (over: Partial<Campaign> = {}): Campaign => ({ account: 'instantly', campaign_id: 'c', channel: 'email', status: 'active', sent_total: 130, replies_total: 6, ...over }) as unknown as Campaign;
const snap = (hoursAgo: number, over: Partial<Snapshot> = {}): Snapshot => ({ account: 'instantly', campaign_id: 'c', taken_at: new Date(NOW - hoursAgo * 3_600_000).toISOString(), sent_total: 0, replies_total: 0, ...over }) as unknown as Snapshot;
const base = (over: Partial<BaselineRow> = {}): BaselineRow => ({ account: 'instantly', campaign_id: 'c', sent_total: 100, replies_total: 4, ...over });

describe('delta24 with the baseline view (R2D02)', () => {
  it('measures against the baseline row, not the older snapshot', () => {
    const d = delta24([camp()], [snap(40, { sent_total: 60, replies_total: 1 })], NOW, [base()]);
    expect(d).toEqual({ sent: 30, replies: 2 });
  });
  it('works with no snapshots at all when a baseline row exists', () => {
    expect(delta24([camp()], [], NOW, [base()]).sent).toBe(30);
  });
  it('skips a campaign that has no baseline row while others do', () => {
    const d = delta24([camp(), camp({ campaign_id: 'new', sent_total: 50 })], [], NOW, [base()]);
    expect(d.sent).toBe(30);
  });
  it('an empty baseline falls back to the old snapshot rule', () => {
    const d = delta24([camp()], [snap(30, { sent_total: 100, replies_total: 4 })], NOW, []);
    expect(d).toEqual({ sent: 30, replies: 2 });
  });
  it('no baseline and no old snapshot is null', () => {
    expect(delta24([camp()], [snap(2)], NOW, undefined)).toEqual({ sent: null, replies: null });
  });
  it('negative counts as 0', () => {
    expect(delta24([camp({ sent_total: 90 })], [], NOW, [base()]).sent).toBe(0);
  });
  it('campaignDelta passes the baseline through', () => {
    expect(campaignDelta(camp(), [], NOW, [base()])).toBe(30);
  });
});
