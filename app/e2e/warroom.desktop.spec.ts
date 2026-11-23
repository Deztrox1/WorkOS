/** The war room on a laptop: the same plan, plus the day at a glance on the right from 1180 px up (logs/qa-r4-plan.md decision 9). */
import { expect, test } from '@playwright/test';
import { TODAY, boot, calEvent, habitRow, rowAction, task } from './helpers';

const tables = () => ({
  os_tasks: [task('Alpha', { planned_for: TODAY, sort_order: 1 }), task('Bravo', { planned_for: TODAY, sort_order: 2 }), task('Timed', { planned_for: TODAY, due_date: TODAY, due_time: '14:00:00' })],
  os_calendar_events: [calEvent('Early block', '07:30', '08:00'), calEvent('Lunch', '13:00', '13:45')],
});

test('WD-01 the day line shows from 1180 px and not below it', async ({ page }) => {
  await boot(page, { tables: tables() });
  const line = page.getByTestId('dayline');
  await expect(line).toBeVisible();
  await expect(line).toHaveAttribute('aria-hidden', 'true'); // it repeats the list
  await page.setViewportSize({ width: 1179, height: 800 });
  await expect(line).toHaveCount(0);
  await expect(page.getByTestId('now-card')).toBeVisible();
  await page.setViewportSize({ width: 1180, height: 800 });
  await expect(line).toBeVisible();
  await expect(page.locator('.war-grid')).toBeVisible();
});

test('WD-02 the panel holds fixed blocks and Now only: planned tasks stay in the list, what has ended is marked past (R4P29)', async ({ page }) => {
  await boot(page, { tables: tables() });
  const blocks = page.getByTestId('dayline').locator('.dl-block');
  await expect(blocks.filter({ hasText: 'Alpha' })).toHaveClass(/\bnow\b/);
  await expect(blocks.filter({ hasText: 'Alpha' })).toHaveClass(/\bflex\b/);
  await expect(blocks.filter({ hasText: 'Bravo' })).toHaveCount(0);
  await expect(blocks.filter({ hasText: 'Lunch' })).not.toHaveClass(/\bflex\b/);
  await expect(blocks.filter({ hasText: 'Timed' })).not.toHaveClass(/\bflex\b/);
  await expect(blocks.filter({ hasText: 'Early block' })).toHaveClass(/\bpast\b/);
  const y = async (t: string) => (await blocks.filter({ hasText: t }).boundingBox())!.y;
  expect(await y('Early block')).toBeLessThan(await y('Alpha'));
  expect(await y('Alpha')).toBeLessThan(await y('Lunch'));
  expect(await y('Lunch')).toBeLessThan(await y('Timed'));
  const nowY = (await page.getByTestId('dayline').locator('.dl-now').boundingBox())!.y;
  expect(nowY).toBeLessThanOrEqual((await y('Alpha')) + 1);
});

test('WD-03 the day line follows the plan when he says Not now', async ({ page }) => {
  await boot(page, { tables: tables() });
  const blocks = page.getByTestId('dayline').locator('.dl-block');
  await expect(blocks.filter({ hasText: 'Alpha' })).toHaveClass(/\bnow\b/);
  await page.getByTestId('now-later').click();
  await expect(blocks.filter({ hasText: 'Bravo' })).toHaveClass(/\bnow\b/);
  await expect(blocks.filter({ hasText: 'Alpha' })).toHaveCount(0);
});

test('WD-04 an early morning stretches the day line up so now is on it', async ({ page }) => {
  await boot(page, { clock: '2026-10-22T05:30:00+05:30', tables: { os_tasks: [task('Alpha', { planned_for: TODAY })] } });
  await expect(page.getByTestId('dayline').locator('.dl-hour').first()).toHaveText('05');
});

test('WD-05 the page never scrolls sideways at the breakpoint or with a long title', async ({ page }) => {
  const long = 'A very long title that goes on and on about a client call with many people in many places '.repeat(3);
  await boot(page, { tables: { os_tasks: [task(long, { planned_for: TODAY }), task('Bravo', { planned_for: TODAY })], os_habits: [habitRow('Read')] } });
  for (const width of [1180, 1280, 1600]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(page.getByTestId('dayline')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('WD-06 on a laptop Ask Claude is on the row and Do first is one menu away', async ({ page }) => {
  await boot(page, { tables: tables() });
  await expect(page.getByTestId('now-card').getByRole('button', { name: 'Ask Claude about Alpha' })).toBeVisible();
  await expect(page.getByTestId('plan-row').filter({ hasText: 'Bravo' }).getByRole('button', { name: 'Ask Claude about Bravo' })).toBeVisible();
  await rowAction(page, 'Bravo', 'Do Bravo first');
  await expect(page.getByTestId('now-title')).toHaveText('Bravo');
});

test('WD-07 no mode switch in the rail anywhere; on a screen it filters it sits at the top of the page', async ({ page }) => {
  await boot(page, { tables: tables() });
  await expect(page.getByTestId('now-title')).toHaveText('Alpha');
  const rail = page.locator('.rail');
  await expect(rail.getByRole('button', { name: 'Personal', exact: true })).toHaveCount(0);
  await page.goto('/?mock=1#/plan');
  await expect(page.getByRole('heading', { name: 'Close today' })).toBeVisible();
  await expect(page.getByTestId('mode-line')).toHaveCount(0);
  await page.goto('/?mock=1#/tasks');
  await expect(page.getByRole('main').getByRole('button', { name: 'Personal', exact: true })).toBeVisible();
  await expect(rail.getByRole('button', { name: 'Personal', exact: true })).toHaveCount(0);
});

test('WD-08 overlapping blocks sit side by side, so nothing hides another (R4U11)', async ({ page }) => {
  await boot(page, { tables: { os_calendar_events: [calEvent('Lunch', '12:00', '13:00'), calEvent('Call', '12:15', '12:45'), calEvent('Later', '15:00', '16:00')] } });
  const blocks = page.getByTestId('dayline').locator('.dl-block');
  const box = async (t: string) => (await blocks.filter({ hasText: t }).boundingBox())!;
  const [a, b, c] = [await box('Lunch'), await box('Call'), await box('Later')];
  expect(a.x + a.width).toBeLessThanOrEqual(b.x + 1);
  expect(c.width).toBeGreaterThan(a.width * 1.5);
});

test('WD-09 the panel scrolls to now, and late blocks and late nights fit (R4U12)', async ({ page }) => {
  await boot(page, { clock: '2026-10-22T23:30:00+05:30', tables: { os_calendar_events: [calEvent('Late call', '23:15', '23:50')] } });
  const line = page.getByTestId('dayline');
  await expect(line.locator('.dl-hour').last()).toHaveText('24');
  await expect(line.locator('.dl-now')).toBeInViewport();
  await expect(line).toHaveAttribute('tabindex', '-1');
});

test('WD-10 a task sheet never crushes the paper (R4U03)', async ({ page }) => {
  await boot(page, { tables: tables() });
  for (const [width, least] of [[1280, 500], [1180, 460], [900, 500]] as const) {
    await page.setViewportSize({ width, height: 800 });
    await page.getByTestId('now-title').click();
    await expect(page.getByRole('dialog', { name: 'Task' })).toBeVisible();
    expect((await page.getByTestId('day-sheet').boundingBox())!.width).toBeGreaterThanOrEqual(least);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Task' })).toHaveCount(0);
  }
});

test('WD-10 on a laptop a task holds 130 px and a fixed thing 88 px (R4Y13)', async ({ page }) => {
  const hold = () => page.locator('.nc-swap').evaluate((e) => getComputedStyle(e).minHeight);
  await boot(page, { tables: tables() });
  await expect(page.getByTestId('now-card')).toHaveAttribute('data-kind', 'task');
  expect(await hold()).toBe('130px');
  await page.clock.fastForward('04:10:00');
  await expect(page.getByTestId('now-card')).toHaveAttribute('data-kind', 'event');
  expect(await hold()).toBe('88px');
});
