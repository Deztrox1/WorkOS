import { addDays, istDate } from '../../shared/ist';
import type { Campaign, Snapshot, SmsDay } from '../types';

export const isActive = (c: Pick<Campaign, 'status'>) => c.status === 'active' || c.status === 'published';

/** Bounces over sent. Blank when sent is null or 0. */
export function bounceText(sent: number | null, bounces: number | null): string {
  if (!sent || bounces === null || bounces === undefined) return '';
  return `${((bounces / sent) * 100).toFixed(1)}%`;
}
export function bouncePct(sent: number | null, bounces: number | null): number | null {
  if (!sent || bounces === null || bounces === undefined) return null;
  return (bounces / sent) * 100;
}

const STATUS_ORDER = ['active', 'published', 'paused', 'draft', 'completed'];
export function statusRank(s: string | null): number {
  if (s === 'active' || s === 'published') return 0;
  const i = STATUS_ORDER.indexOf(s ?? '');
  return i < 0 ? 4 : i - 1;
}
/** Active/published, paused, draft, completed, other; then name. */
export function sortCampaigns(rows: Campaign[]): Campaign[] {
  return [...rows].sort(
    (a, b) => statusRank(a.status) - statusRank(b.status) || a.campaign_name.localeCompare(b.campaign_name),
  );
}

export function playbookStatus(c: Campaign): string | null {
  const v = (c.raw as { playbook_status?: unknown } | null)?.playbook_status;
  return typeof v === 'string' ? v : null;
}
/**
 * Status vocabulary (PRD 4 Playbook status): parked = paused, planned = draft, published / in-progress / live = active,
 * completed stays completed. Anything else compares as its lower-case self.
 */
export function normStatus(v: string | null | undefined): string {
  const x = (v ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (x === 'parked' || x === 'paused') return 'paused';
  if (x === 'planned' || x === 'draft') return 'draft';
  if (x === 'active' || x === 'published' || x === 'in-progress' || x === 'live') return 'active';
  if (x === 'completed' || x === 'complete') return 'completed';
  return x;
}
/** The mismatch chip shows only when both statuses are present and their mapped values differ. */
export function mismatch(c: Campaign): boolean {
  const pb = playbookStatus(c);
  if (!pb || !c.status) return false;
  return normStatus(pb) !== normStatus(c.status);
}

export function externalLink(c: Campaign): string {
  if (c.channel === 'email') return `https://app.instantly.ai/app/campaign/${c.campaign_id}`;
  const loc = (c.raw as { location_id?: string } | null)?.location_id ?? '';
  return `https://app.gohighlevel.com/v2/location/${loc}/workflow/${c.campaign_id}`;
}

export type Delta = { sent: number | null; replies: number | null };

/** A row of `os_campaign_baseline24`: the newest snapshot taken between 48 h and 24 h ago, per campaign. */
export type BaselineRow = Pick<Snapshot, 'account' | 'campaign_id' | 'sent_total' | 'replies_total'>;

/**
 * 24 h delta over active email campaigns: latest minus the baseline.
 * With `baseline` rows (the database view), each campaign is measured against its own baseline row; a campaign without one is skipped.
 * Without baseline rows it falls back to the newest snapshot at or before now - 24 h.
 * A campaign without a baseline is skipped; no baseline anywhere gives null. Negative counts as 0.
 */
export function delta24(latest: Campaign[], snaps: Snapshot[], nowMs: number, baseline?: BaselineRow[]): Delta {
  const cutoff = nowMs - 86_400_000;
  const useView = !!baseline && baseline.length > 0;
  let sent: number | null = null;
  let replies: number | null = null;
  for (const c of latest) {
    if (c.channel !== 'email' || !isActive(c)) continue;
    const base: BaselineRow | undefined = useView
      ? baseline!.find((s) => s.account === c.account && s.campaign_id === c.campaign_id)
      : snaps
          .filter((s) => s.account === c.account && s.campaign_id === c.campaign_id && new Date(s.taken_at).getTime() <= cutoff)
          .sort((x, y) => new Date(y.taken_at).getTime() - new Date(x.taken_at).getTime())[0];
    if (!base) continue;
    sent = (sent ?? 0) + Math.max(0, (c.sent_total ?? 0) - (base.sent_total ?? 0));
    replies = (replies ?? 0) + Math.max(0, (c.replies_total ?? 0) - (base.replies_total ?? 0));
  }
  return { sent, replies };
}

export function campaignDelta(c: Campaign, snaps: Snapshot[], nowMs: number, baseline?: BaselineRow[]): number | null {
  const d = delta24([c], snaps, nowMs, baseline);
  return d.sent;
}

export type Point = { day: string; value: number };

/** One point per IST day (the last snapshot of the day), the last 14 days. */
export function sparkPoints(
  snaps: Snapshot[],
  account: string,
  campaignId: string,
  metric: 'sent_total' | 'replies_total' | 'positives_total',
  today: string,
): Point[] {
  const first = addDays(today, -13);
  const byDay = new Map<string, { t: number; v: number }>();
  for (const s of snaps) {
    if (s.account !== account || s.campaign_id !== campaignId) continue;
    const t = new Date(s.taken_at).getTime();
    const day = istDate(t);
    if (day < first || day > today) continue;
    const v = s[metric];
    if (v === null || v === undefined) continue;
    const cur = byDay.get(day);
    if (!cur || t > cur.t) byDay.set(day, { t, v });
  }
  return [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([day, x]) => ({ day, value: x.v }));
}

/** The latest IST day on which any email campaign's sent total rose. */
export function lastSendDay(snaps: Snapshot[]): string | null {
  const by = new Map<string, Snapshot[]>();
  for (const s of snaps) {
    if (s.channel !== 'email') continue;
    const k = `${s.account}|${s.campaign_id}`;
    (by.get(k) ?? by.set(k, []).get(k)!).push(s);
  }
  let best: string | null = null;
  for (const list of by.values()) {
    list.sort((a, b) => new Date(a.taken_at).getTime() - new Date(b.taken_at).getTime());
    for (let i = 1; i < list.length; i++) {
      if ((list[i].sent_total ?? 0) > (list[i - 1].sent_total ?? 0)) {
        const day = istDate(new Date(list[i].taken_at).getTime());
        if (!best || day > best) best = day;
      }
    }
  }
  return best;
}

export type TodayCampaigns = {
  activeEmail: number;
  replies: number;
  positives: number;
  sms: { sent: number; replies: number; positives: number } | null;
  worst: Campaign | null;
};

export function todayCampaigns(latest: Campaign[], sms: SmsDay[], yesterday: string): TodayCampaigns {
  const active = latest.filter((c) => c.channel === 'email' && isActive(c));
  const y = sms.filter((s) => s.day === yesterday);
  const worst = active
    .filter((c) => (c.sent_total ?? 0) >= 100 && (bouncePct(c.sent_total, c.bounces_total) ?? 0) > 3)
    .sort((a, b) => (bouncePct(b.sent_total, b.bounces_total) ?? 0) - (bouncePct(a.sent_total, a.bounces_total) ?? 0))[0];
  return {
    activeEmail: active.length,
    replies: active.reduce((s, c) => s + (c.replies_total ?? 0), 0),
    positives: active.reduce((s, c) => s + (c.positives_total ?? 0), 0),
    sms: y.length
      ? {
          sent: y.reduce((s, r) => s + (r.sent ?? 0), 0),
          replies: y.reduce((s, r) => s + (r.replies ?? 0), 0),
          positives: y.reduce((s, r) => s + (r.positives ?? 0), 0),
        }
      : null,
    worst: worst ?? null,
  };
}
