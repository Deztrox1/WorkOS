/** Stories covered: FD-01 FD-03 FD-04 FD-05 FD-06 FD-07 FD-08 FD-09 FD-10 */
import { expect, test, type Page } from '@playwright/test';
import { ago, boot, db, event, external } from './helpers';

const rows = (page: Page) => page.getByTestId('feed-row');
const badge = (page: Page) => page.getByTestId('feed-badge');
const evt3 = () => [
  event('Instantly bounce high', { severity: 'bad', occurred_at: ago(10 * 60_000) }),
  event('Invoice behind', { severity: 'warn', kind: 'invoice', occurred_at: ago(60 * 60_000) }),
  event('Scheduled jobs are running', { severity: 'info', kind: 'system', occurred_at: ago(3 * 3600_000) }),
];

/** Two more bad events, older than the ones on Today: Today shows the 2 newest bad alerts, so the badge counts the rest. */
const oldBad = () => [event('Old bad', { severity: 'bad', occurred_at: ago(5 * 3600_000) }), event('Older bad', { severity: 'bad', occurred_at: ago(6 * 3600_000) })];

test('FD-01 Feed lists newest first and Mark all read clears the badge', async ({ page }) => {
  await boot(page, { hash: '#/feed', tables: { os_events: [...evt3(), ...oldBad()] } });
  await expect(rows(page).locator('.t1')).toHaveText(['Instantly bounce high', 'Invoice behind', 'Scheduled jobs are running', 'Old bad', 'Older bad']);
  // The badge counts only bad, unread events that are not already on Today (decision 10): 3 bad, 2 on Today.
  await expect(badge(page).first()).toHaveText('1');
  await page.getByRole('button', { name: 'Mark all read' }).click();
  await expect(badge(page)).toHaveCount(0);
  expect((await db<{ read_at: string | null }>(page, 'os_events')).every((e) => e.read_at)).toBe(true);
});

test('FD-03 a tap marks read; only an event with a url opens it', async ({ page }) => {
  await page.context().route('https://github.com/**', (r) => r.fulfill({ body: 'ok' }));
  await boot(page, { hash: '#/feed', tables: { os_events: [event('With link', { url: 'https://github.com/a' }), event('No link')] } });
  const popup = page.waitForEvent('popup');
  await rows(page).filter({ hasText: 'With link' }).click();
  expect((await popup).url()).toContain('github.com/a');
  let opened = false;
  page.on('popup', () => { opened = true; });
  await rows(page).filter({ hasText: 'No link' }).click();
  await expect.poll(async () => (await db<{ read_at: string | null }>(page, 'os_events')).every((e) => e.read_at)).toBe(true);
  expect(opened).toBe(false);
});

test('FD-04 one Show control: unread, or one kind, with no news kind', async ({ page }) => {
  const evs = [
    event('a1', { kind: 'alert' }), event('a2', { kind: 'alert', read_at: ago(0) }), event('i1', { kind: 'invoice' }),
    event('i2', { kind: 'invoice', read_at: ago(0) }), event('i3', { kind: 'invoice' }), event('s1', { kind: 'system' }),
  ];
  await boot(page, { hash: '#/feed', tables: { os_events: evs } });
  const show = page.getByLabel('Show');
  await show.selectOption({ label: 'Unread' });
  await expect(rows(page)).toHaveCount(4); // the screen loads on demand
  expect((await rows(page).locator('.t1').allInnerTexts()).sort()).toEqual(['a1', 'i1', 'i3', 's1']);
  await show.selectOption({ label: 'Invoices' });
  expect((await rows(page).locator('.t1').allInnerTexts()).sort()).toEqual(['i1', 'i2', 'i3']);
  await show.selectOption({ label: 'All' });
  await expect(rows(page)).toHaveCount(6);
  expect(await show.locator('option').allInnerTexts()).not.toContain('News');
  await expect(page.getByRole('button', { name: 'Unread only' })).toHaveCount(0);
});

test('FD-05 Mark all read follows the mode and filter', async ({ page }) => {
  const evs = [event('work alert', { kind: 'alert' }), event('work lead', { kind: 'lead' }), event('personal alert', { kind: 'alert', area: 'personal' })];
  await boot(page, { hash: '#/feed', tables: { os_events: evs } });
  await page.getByLabel('Show').selectOption({ label: 'Alerts' });
  await page.getByRole('button', { name: 'Mark all read' }).click();
  await expect.poll(async () => (await db<{ title: string; read_at: string | null }>(page, 'os_events')).filter((e) => e.read_at).map((e) => e.title)).toEqual(['work alert']);
});

test('FD-06 50 rows then Load more', async ({ page }) => {
  const evs = Array.from({ length: 120 }, (_, i) => event(`E${i}`, { occurred_at: ago(i * 60_000) }));
  await boot(page, { hash: '#/feed', tables: { os_events: evs } });
  await expect(rows(page)).toHaveCount(50);
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(rows(page)).toHaveCount(100);
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(rows(page)).toHaveCount(120);
  await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
});

test('FD-07 a feed row shows dot, plain word, kind, clamped title and body, source in words, time', async ({ page }) => {
  await boot(page, {
    hash: '#/feed',
    tables: { os_events: [event('Title '.repeat(40), { severity: 'warn', kind: 'alert', body: 'Body '.repeat(80), source: 'ops_heartbeat' })] },
  });
  const r = rows(page);
  await expect(r.locator('.dot.warn')).toBeVisible();
  await expect(r).toContainText('Heads up');
  await expect(r).toContainText('Alert');
  await expect(r).toContainText('System check');
  await expect(r).not.toContainText('ops_heartbeat');
  await expect(r).not.toContainText('warn');
  await expect(r).toContainText('30 min ago');
  expect(await r.locator('.t1').evaluate((e) => getComputedStyle(e).webkitLineClamp)).toBe('2');
  expect(await r.locator('.t2').evaluate((e) => getComputedStyle(e).webkitLineClamp)).toBe('2');
});

test('FD-08 and FD-09 the feed follows the mode; the badge counts both areas, like the war room', async ({ page }) => {
  const bad = { severity: 'bad' };
  const evs = [event('w1', bad), event('w2', bad), event('w3', bad), event('p1', { ...bad, area: 'personal' }), event('p2', { ...bad, area: 'personal' }), event('p3', { ...bad, area: 'personal' }), event('p4', { ...bad, area: 'personal' })];
  await boot(page, { hash: '#/feed', tables: { os_events: evs } });
  await expect(rows(page)).toHaveCount(3);
  await expect(badge(page).first()).toHaveText('5'); // seven, less the two newest that are on the war room
  await page.getByRole('button', { name: 'Personal' }).click();
  await expect(rows(page)).toHaveCount(4);
  await expect(badge(page).first()).toHaveText('5');
});

test('FD-10 a new event appears live and the badge goes up', async ({ page }) => {
  await boot(page, { hash: '#/feed', tables: { os_events: [...evt3(), ...oldBad()] } });
  await expect(rows(page)).toHaveCount(5);
  await expect(badge(page).first()).toHaveText('1');
  await external(page, 'os_events', event('Fresh', { occurred_at: ago(0), severity: 'bad' }), true);
  await expect(rows(page).first()).toContainText('Fresh');
  await expect(badge(page).first()).toHaveText('2');
});
