/** Stories covered: HB-01 HB-03 HB-04 HB-06 HB-07 HB-08 HB-09 HB-10 */
import { expect, test, type Page } from '@playwright/test';
import { TODAY, boot, day, db, habitRow, log } from './helpers';

const base = () => ({
  os_habits: [habitRow('Walk', { sort_order: 0 }), habitRow('Read', { sort_order: 1, days: [1, 2, 3, 4, 5], time_local: '21:00' }), habitRow('Gym', { sort_order: 2 }), habitRow('Water', { sort_order: 3 })],
  os_habit_logs: [log('Walk', day(-1)), log('Walk', day(-2)), log('Walk', day(-3))],
});
const names = (page: Page) => page.getByTestId('habit-item').evaluateAll((els) => els.map((e) => e.getAttribute('data-habit')));

test('HB-01 each row has a 14 day strip, current and best streak', async ({ page }) => {
  await boot(page, { hash: '#/habits', mode: 'personal', tables: base() });
  await expect(page.getByTestId('habit-item')).toHaveCount(4);
  const walk = page.locator('[data-testid="habit-item"][data-habit="Walk"]');
  await expect(walk.locator('.strip button')).toHaveCount(14);
  await expect(walk.getByTestId('streak')).toHaveText('streak 3');
  await expect(walk.getByTestId('best')).toHaveText('best 3');
});

test('HB-03 tapping a day toggles its log', async ({ page }) => {
  await boot(page, { hash: '#/habits', mode: 'personal', tables: base() });
  const cell = page.getByTestId('habit-item').filter({ hasText: 'Read' }).locator(`.strip button[data-day="${day(-1)}"]`);
  await cell.click();
  await expect.poll(async () => (await db<{ habit_id: string; day: string }>(page, 'os_habit_logs')).some((l) => l.habit_id === 'h-Read' && l.day === day(-1))).toBe(true);
  await cell.click();
  await expect.poll(async () => (await db<{ habit_id: string; day: string }>(page, 'os_habit_logs')).some((l) => l.habit_id === 'h-Read' && l.day === day(-1))).toBe(false);
});

test('HB-04 the streak goes from 0 to 1 without a reload', async ({ page }) => {
  await boot(page, { hash: '#/habits', mode: 'personal', tables: { os_habits: [habitRow('Solo')] } });
  const item = page.getByTestId('habit-item');
  await expect(item.getByTestId('streak')).toHaveCount(0);
  await expect(item.getByTestId('best')).toHaveCount(0);
  await item.locator(`.strip button[data-day="${TODAY}"]`).click();
  await expect(item.getByTestId('streak')).toHaveText('streak 1');
});

test('HB-06 and HB-07 add then edit a habit', async ({ page }) => {
  await boot(page, { hash: '#/habits', mode: 'personal', tables: base() });
  await page.locator('main.content').getByRole('button', { name: 'New habit', exact: true }).click();
  await page.getByLabel('Name').fill('Read 20 min');
  for (const d of ['Sat', 'Sun']) await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByLabel('Time (IST, optional)').fill('21:00');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('habit-item')).toHaveCount(5);
  const rows = await db<{ name: string; sort_order: number; days: number[] }>(page, 'os_habits');
  const mine = rows.find((r) => r.name === 'Read 20 min')!;
  expect(mine.sort_order).toBe(4);
  expect(mine.days).toEqual([1, 2, 3, 4, 5]);
  await page.getByRole('button', { name: 'Edit Read 20 min' }).click();
  await page.getByRole('button', { name: 'Tue', exact: true }).click();
  await page.getByRole('button', { name: 'Thu', exact: true }).click();
  await page.getByLabel('Time (IST, optional)').fill('20:00');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect.poll(async () => (await db<{ name: string; days: number[]; time_local: string }>(page, 'os_habits')).find((r) => r.name === 'Read 20 min')?.time_local).toBe('20:00');
  const edited = (await db<{ name: string; days: number[] }>(page, 'os_habits')).find((r) => r.name === 'Read 20 min')!;
  expect(edited.days).toEqual([1, 3, 5]);
  const strip = page.getByTestId('habit-item').filter({ hasText: 'Read 20 min' }).locator('.strip button');
  const states = await strip.evaluateAll((els) => els.map((e) => [e.getAttribute('data-day'), e.getAttribute('data-state')]));
  expect(states.filter(([d, s]) => ['2026-10-20', '2026-10-22'].includes(d as string) && s === 'off')).toHaveLength(2);
});

test('HB-08 and HB-09 archive keeps logs; restore brings the streak back', async ({ page }) => {
  await boot(page, { hash: '#/habits', mode: 'personal', tables: base() });
  await page.getByRole('button', { name: 'Actions for Walk' }).click();
  await page.getByRole('menuitem', { name: 'Archive Walk' }).click();
  await expect(page.getByTestId('habit-item')).toHaveCount(3);
  expect(await db(page, 'os_habit_logs')).toHaveLength(3);
  await page.goto('/#/');
  await expect(page.getByText('Walk')).toHaveCount(0);
  await page.goto('/#/habits');
  await page.getByRole('button', { name: /Archived \(1\)/ }).click();
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.locator('[data-testid="habit-item"][data-habit="Walk"]').getByTestId('streak')).toHaveText('streak 3');
});

test('HB-10 habits are listed by time of day, untimed last', async ({ page }) => {
  await boot(page, { hash: '#/habits', mode: 'personal', tables: base() });
  await expect.poll(() => names(page)).toEqual(['Read', 'Walk', 'Gym', 'Water']);
});

test('HB-11 one action menu per row, with no move items', async ({ page }) => {
  await boot(page, { hash: '#/habits', mode: 'personal', tables: base() });
  const walk = page.locator('[data-testid="habit-item"][data-habit="Walk"]');
  await expect(walk.getByRole('button', { name: /^Actions for/ })).toHaveCount(1);
  for (const n of ['Move Walk up', 'Move Walk down', 'Archive Walk']) await expect(walk.getByRole('button', { name: n })).toHaveCount(0);
  await walk.getByRole('button', { name: 'Actions for Walk' }).click();
  await expect(page.getByRole('menuitem', { name: 'Archive Walk' })).toBeEnabled();
  await expect(page.getByRole('menuitem', { name: /Move Walk/ })).toHaveCount(0);
});

test('HB-12 a missed day is a plain hollow square with no slash', async ({ page }) => {
  await boot(page, { hash: '#/habits', mode: 'personal', tables: base() });
  const missed = page.getByTestId('habit-item').filter({ hasText: 'Gym' }).locator('.strip button[data-state="missed"] > span').first();
  expect(await missed.evaluate((e) => getComputedStyle(e).backgroundImage)).toBe('none');
  await expect(page.getByRole('button', { name: /^Gym .* not done$/ }).first()).toBeVisible();
});
