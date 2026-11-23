/** The add button (QA r1 F08): a capture line over the current screen, with Reminder, Note and Ask Claude beside it. */
import { expect, test } from '@playwright/test';
import { TODAY, boot, db } from './helpers';

test('FB-01 the add button opens the capture line, focused, and Escape closes it back to the button', async ({ page }) => {
  await boot(page, { tables: {} });
  const add = page.getByTestId('add');
  await expect(add).toHaveAttribute('aria-expanded', 'false');
  await add.click();
  const dlg = page.getByRole('dialog', { name: 'Add' });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole('textbox', { name: 'Quick add' })).toBeFocused();
  await expect(dlg.getByRole('group', { name: 'Or add' }).getByRole('button')).toHaveText(['Reminder', 'Note', 'Ask Claude', 'Save task']);
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  await expect(add).toBeFocused();
});

test('FB-02 Enter saves the task and closes, and you stay where you were', async ({ page }) => {
  await boot(page, { hash: '#/notes', tables: {} });
  await page.getByTestId('add').click();
  await page.getByRole('textbox', { name: 'Quick add' }).fill('Call Sam tomorrow 3pm 20m #sales');
  await expect(page.getByTestId('capture-preview')).toContainText('Call Sam');
  await expect(page.getByTestId('capture-preview')).toContainText('20 min');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Add' })).toHaveCount(0);
  await expect(page).toHaveURL(/#\/notes$/);
  // exactly one toast, with a Today button
  await expect(page.locator('.toasts .toast')).toHaveCount(1);
  await expect(page.locator('.toasts .toast')).toContainText('Added: Call Sam');
  await expect(page.locator('.toasts .toast').getByRole('button', { name: 'Today' })).toBeVisible();
  await expect.poll(async () => (await db<{ title: string; due_time: string; est_minutes: number; project: string; area: string }>(page, 'os_tasks'))[0]).toMatchObject({ title: 'Call Sam', due_time: '15:00', est_minutes: 20, project: 'sales', area: 'work' });
});

test('FB-03 Reminder, Note and Ask Claude each switch to their own sheet; Ask Claude carries the typed text', async ({ page }) => {
  await boot(page, { tables: {} });
  await page.getByTestId('add').click();
  await page.getByRole('button', { name: 'Reminder' }).click();
  await expect(page.getByRole('dialog', { name: 'Reminder' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByTestId('add').click();
  await page.getByRole('button', { name: 'Note' }).click();
  await expect(page.getByRole('dialog', { name: 'Note' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByTestId('add').click();
  await page.getByRole('textbox', { name: 'Quick add' }).fill('Find three dentists near me');
  await page.getByRole('dialog', { name: 'Add' }).getByRole('button', { name: 'Ask Claude' }).click();
  const claude = page.getByRole('dialog', { name: 'Ask Claude' });
  await expect(claude).toBeVisible();
  await expect(claude.getByLabel('Brief')).toHaveValue('Find three dentists near me');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('add')).toBeFocused(); // the opener is gone, focus falls back to the add button (U22)
  expect(await db(page, 'os_tasks')).toHaveLength(0);
});

test('FB-04 the add button stays on every screen', async ({ page }) => {
  await boot(page, { tables: {} });
  for (const h of ['#/tasks', '#/reminders', '#/campaigns', '#/finance', '#/notes', '#/claude', '#/activity', '#/settings', '#/']) {
    await page.goto(`/?mock=1${h}`);
    await expect(page.getByTestId('add')).toBeVisible();
  }
});

test('FB-04b there is one add button, in the top bar next to the theme switch, and no floating disc', async ({ page }) => {
  await boot(page, { tables: {} });
  await expect(page.getByTestId('add')).toHaveCount(1);
  await expect(page.locator('.fab')).toHaveCount(0);
  const bar = page.locator('.topbar');
  await expect(bar.getByTestId('add')).toBeVisible();
  const a = (await bar.getByTestId('add').boundingBox())!;
  const t = (await bar.getByRole('switch', { name: /theme/i }).boundingBox())!;
  expect(a.width).toBeGreaterThanOrEqual(43.5);
  expect(a.height).toBeGreaterThanOrEqual(43.5);
  expect(a.x + a.width).toBeLessThanOrEqual(t.x + 1); // before the theme switch
});

test('FB-05 /feed redirects to /activity', async ({ page }) => {
  await boot(page, { hash: '#/feed', tables: {} });
  await expect(page).toHaveURL(/#\/activity/);
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();
});

test('FB-06 /plan is its own screen with the Tomorrow block open', async ({ page }) => {
  await boot(page, { hash: '#/plan', tables: {} });
  await expect(page.getByTestId('tomorrow')).toBeVisible();
  await expect(page).toHaveURL(/#\/plan$/);
});

test('FB-07 a task captured on Today with a time today lands on the plan', async ({ page }) => {
  await boot(page, { tables: {} });
  await page.getByTestId('add').click();
  await page.getByRole('textbox', { name: 'Quick add' }).fill('Pay rent today 5pm');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('now-title')).toHaveText('Free until Pay rent at 17:00.');
  await expect(page.getByTestId('plan-row').filter({ hasText: 'Pay rent' }).locator('.wl-time')).toContainText('17:00');
  expect((await db<{ due_date: string }>(page, 'os_tasks'))[0].due_date).toBe(TODAY);
});
