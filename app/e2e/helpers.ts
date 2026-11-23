import { expect, type Locator, type Page } from '@playwright/test';
import { addDays, istDate } from '../src/shared/ist';
import { baseTask, emptyState, type MockState } from '../src/lib/data/fixtures';

/** The pinned clock: Thu 2026-10-22 09:00 IST. */
export const NOW = '2026-10-22T09:00:00+05:30';
export const NOW_MS = new Date(NOW).getTime();
export const TODAY = istDate(NOW_MS);
export const day = (n: number) => addDays(TODAY, n);
export const ago = (ms: number) => new Date(NOW_MS - ms).toISOString();
export const iso = (date: string, time = '00:00') => new Date(`${date}T${time}:00+05:30`).toISOString();

export { baseTask, emptyState };
export const task = (title: string, over: Record<string, unknown> = {}) => baseTask({ title, ...over }, NOW_MS);

export function settings(over: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    default_mode: 'work',
    profit_target: 1000,
    fx: { USD: 1, INR: 1 / 84, GBP: 1.3 },
    last_opened_at: ago(3600_000),
    // The evening step is off unless a test asks for it, so a row count means what the test set up (logs/qa-r4-plan.md call H).
    plan_skip: { day: TODAY, ids: ['plan-tomorrow'], more: 0 },
    ...over,
  };
  return Object.entries(base).map(([key, value]) => ({ key, value, updated_at: ago(0) }));
}

type BootOpts = {
  /** Replace the whole mock database. Omit to use the app's default seed. */
  tables?: Partial<MockState>;
  signedIn?: boolean;
  hash?: string;
  clock?: string | false;
  fail?: { reads?: Record<string, number>; writes?: number };
  mode?: 'work' | 'personal' | null;
  latency?: number;
  query?: string;
  theme?: 'light' | 'dark';
};

export async function boot(page: Page, o: BootOpts = {}) {
  const { tables, signedIn = true, hash = '#/', clock = NOW, fail, mode, query = '?mock=1', theme, latency } = o;
  if (clock) await page.clock.install({ time: new Date(clock) });
  const state = tables ? { ...emptyState(), os_settings: settings() as never, ...tables } : null;
  await page.addInitScript(
    ({ state, signedIn, fail, mode, theme, latency }) => {
      if (sessionStorage.getItem('__seeded')) return;
      sessionStorage.setItem('__seeded', '1');
      localStorage.clear();
      localStorage.setItem('workos.data', 'mock');
      if (state) localStorage.setItem('workos.mock.v1', JSON.stringify(state));
      if (signedIn) localStorage.setItem('workos.mock.session', 'owner@example.com');
      if (fail) localStorage.setItem('workos.mock.fail', JSON.stringify(fail));
      if (mode) localStorage.setItem('workos.mode', mode);
      if (theme) localStorage.setItem('workos.theme', theme);
      if (latency) localStorage.setItem('workos.mock.latency', String(latency));
    },
    { state, signedIn, fail: fail ?? null, mode: mode === undefined ? 'work' : mode, theme: theme ?? null, latency: latency ?? 0 },
  );
  await page.goto(`/${query}${hash}`);
  // The sample client loads on demand (QA r4 R4S01), so wait for it before a test reaches for window.__mock.
  await page.waitForFunction(() => !!(window as unknown as { __mock?: unknown }).__mock);
}

export const db = <T = Record<string, unknown>>(page: Page, table: string) =>
  page.evaluate((t) => (window as unknown as { __mock: { get(t: string): unknown[] } }).__mock.get(t), table) as Promise<T[]>;

export const external = (page: Page, table: string, row: Record<string, unknown>, notify = false) =>
  page.evaluate(([t, r, n]) => (window as unknown as { __mock: { external(t: string, r: unknown, n: boolean): void } }).__mock.external(t as string, r, n as boolean), [table, row, notify] as const);

// ---- fixture builders -------------------------------------------------------------------------
let seq = 0;
export const snapRow = (over: Record<string, unknown>) => ({
  id: ++seq + 1000, taken_at: ago(2 * 3600_000), channel: 'email', account: 'instantly', campaign_id: `c${seq}`, campaign_name: `Camp ${seq}`,
  status: 'active', sent_total: 0, replies_total: 0, positives_total: 0, bounces_total: 0, opens_total: 0, leads_total: 0, raw: {}, ...over,
});
export const event = (title: string, over: Record<string, unknown> = {}) => ({
  id: `e-${title}-${++seq}`, kind: 'alert', title, body: null, severity: 'info', area: 'work', source: 'ops_heartbeat', url: null,
  occurred_at: ago(30 * 60_000), read_at: null, created_at: ago(30 * 60_000), pushed_at: ago(0), ...over,
});
export const habitRow = (name: string, over: Record<string, unknown> = {}) => ({
  id: `h-${name}`, name, area: 'personal', days: [0, 1, 2, 3, 4, 5, 6], time_local: null, active: true, sort_order: 0, created_at: ago(30 * 86400_000), last_pushed_on: null, ...over,
});
export const log = (habit: string, date: string) => ({ habit_id: `h-${habit}`, day: date, done: true, note: null, created_at: ago(0) });
export const reminderRow = (title: string, over: Record<string, unknown> = {}) => ({
  id: `r-${title}`, title, notes: null, area: 'work', remind_at: null, time_local: null, repeat: 'none', repeat_days: [], active: true,
  last_fired_at: null, task_id: null, snooze_of: null, created_at: ago(86400_000), updated_at: ago(86400_000), ...over,
});
export const noteRow = (title: string, over: Record<string, unknown> = {}) => ({
  id: `n-${title}`, title, body: '', area: 'work', pinned: false, created_at: ago(86400_000), updated_at: ago(86400_000), ...over,
});
export const fin = (label: string, over: Record<string, unknown> = {}) => ({
  id: `f-${label}`, kind: 'cost', label, amount: 10, currency: 'USD', recurrence: 'one_time', month: '2026-10-01', end_month: null,
  source: 'manual', source_ref: null, notes: null, created_at: ago(0), updated_at: ago(0), ...over,
});
/** A Claude request row. Defaults to a routine hand-off the sender is working on (sent, with a session link). */
export const claudeRow = (title: string, over: Record<string, unknown> = {}) => ({
  id: `c-${title}`, area: 'work', task_id: null, title, brief: title, status: 'sent', handoff: 'routine', session_url: 'https://claude.ai/code/session_x', result: null,
  error: null, attempts: 1, seen_at: null, sent_at: ago(10 * 60_000), finished_at: null, created_by: 'mock-owner', created_at: ago(11 * 60_000), updated_at: ago(10 * 60_000), ...over,
});
export const smsDay = (account: string, over: Record<string, unknown> = {}) => ({
  day: day(-1), account, sent: 0, replies: 0, positives: 0, negatives: 0, stops: 0, capped: false, created_at: ago(0), ...over,
});

/** Google Calendar mirror rows (logs/qa-r4-plan.md, migration 0010). */
export const calEvent = (title: string, from: string, to: string, over: Record<string, unknown> = {}) => ({
  id: `g-${title}-${++seq}`, title, starts_at: iso(TODAY, from), ends_at: iso(TODAY, to), all_day_from: null, all_day_to: null, busy: true,
  html_link: null, meet_link: null, task_id: null, synced_at: ago(0), ...over,
});
/** `to` is exclusive, as Google gives it. */
export const allDayEvent = (title: string, from = TODAY, to = day(1), over: Record<string, unknown> = {}) => ({
  id: `g-${title}-${++seq}`, title, starts_at: null, ends_at: null, all_day_from: from, all_day_to: to, busy: true,
  html_link: null, meet_link: null, task_id: null, synced_at: ago(0), ...over,
});
export const calState = (over: Record<string, unknown> = {}) => ({ id: true, linked: true, last_ok_at: ago(0), problem: null, updated_at: ago(0), ...over });

/** Record window.open instead of opening a tab, so a test can prove a link did nothing. Call before boot. */
export const spyOpen = (page: Page) => page.addInitScript(() => {
  const w = window as unknown as { __opened: string[] };
  w.__opened = [];
  window.open = ((url?: string) => { w.__opened.push(String(url)); return null; }) as typeof window.open;
});
export const windowOpens = (page: Page) => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);

/** A task row on Tasks and in the Tomorrow block (task-row), on /plan (sheet-row) or on the war room (plan-row). */
export const ROW = '[data-testid="task-row"], [data-testid="sheet-row"][data-kind="task"], [data-testid="plan-row"][data-task-id]';
export const anyRow = (page: Page) => page.locator(ROW);

/**
 * Click a task-row action by its accessible name: a button on wide screens, a menu item behind "Actions for <title>" on a phone.
 * Pass `within` when the same task shows twice on the page (a task planned for today is on the sheet and in the Tomorrow block).
 */
export async function rowAction(page: Page, title: string, name: string | RegExp, within?: Locator) {
  const root = within ?? page.locator('body');
  const menu = root.getByRole('button', { name: `Actions for ${title}` }).first();
  const inline = root.locator(ROW).filter({ hasText: title }).getByRole('button', { name, exact: true });
  // On a follow-up row the tick itself is "Followed up <title>" (QA r1 F12).
  const tick = typeof name === 'string' ? root.locator(ROW).filter({ hasText: title }).getByRole('checkbox', { name: `${name} ${title}`, exact: true }) : null;
  if (tick && await tick.count()) {
    await tick.first().click();
  } else if (await inline.count()) {
    await inline.first().click();
  } else if (await menu.isVisible()) {
    await menu.click();
    await root.getByRole('menuitem', { name }).first().click();
  } else {
    await root.getByRole('button', { name }).click();
  }
}

/** True when the row offers an action of that name (button on wide screens, menu item on a phone). Leaves the menu closed. */
export async function rowHas(page: Page, title: string, name: string | RegExp, within?: Locator): Promise<boolean> {
  const root = within ?? page.locator('body');
  const menu = root.getByRole('button', { name: `Actions for ${title}` }).first();
  const inline = await root.locator(ROW).filter({ hasText: title }).getByRole('button', { name, exact: true }).count();
  if (inline) return true;
  if (typeof name === 'string' && await root.locator(ROW).filter({ hasText: title }).getByRole('checkbox', { name: `${name} ${title}`, exact: true }).count()) return true;
  if (await menu.isVisible()) {
    await menu.click();
    const n = await root.getByRole('menuitem', { name }).count();
    await page.keyboard.press('Escape');
    return n > 0;
  }
  return (await root.locator(ROW).filter({ hasText: title }).getByRole('button', { name }).count()) > 0;
}

/** The visible labels of the links inside a nav, in order, without unread badges. */
export const linkLabels = (nav: Locator): Promise<string[]> =>
  nav.getByRole('link').evaluateAll((els) => els.map((e) => (e.querySelector('span:not(.badge)')?.textContent ?? '').trim()));

/** /plan always shows the Tomorrow block: wait for it. */
export async function openPlan(page: Page) {
  await expect(page.getByTestId('tomorrow')).toBeVisible();
}

/** Open one of the war room's folds: look, claude, spare, older, done. */
export async function openFold(page: Page, id: string) {
  const t = page.getByTestId(`fold-${id}`);
  if ((await t.getAttribute('aria-expanded')) !== 'true') await t.click();
  await expect(t).toHaveAttribute('aria-expanded', 'true');
}
