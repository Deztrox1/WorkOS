/** Stories covered: OF-01 OF-02 OF-03 OF-04 OF-05 OF-06 OF-07, SH-17, SH-09 */
import { expect, test } from '@playwright/test';
import { TODAY, ago, boot, db, external, habitRow, snapRow, task } from './helpers';

test('OF-01 and OF-02 Today renders from cache offline and writes are disabled', async ({ page, context }) => {
  await boot(page, { tables: { os_tasks: [task('First task', { planned_for: TODAY, sort_order: 1 }), task('Cached task', { planned_for: TODAY, sort_order: 2 })], os_habits: [habitRow('Walk')], os_events: [] } });
  await expect(page.getByRole('button', { name: 'Open Cached task' })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Open Cached task' })).toBeVisible();
  // the screens load on demand: once the service worker is in charge they are all fetched, opened or not
  await expect.poll(() => page.evaluate(async () => {
    const urls = (await Promise.all((await caches.keys()).map(async (k) => (await (await caches.open(k)).keys()).map((r) => r.url)))).flat();
    return ['Plan', 'Tasks', 'Settings', 'Capture'].filter((n) => !urls.some((u) => u.includes(`/assets/${n}-`)));
  })).toEqual([]);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('offline-banner')).toHaveText(/^You are offline\. This is how things stood at (\d\d:\d\d|--:--)\.$/);
  await expect(page.getByRole('button', { name: 'Open Cached task' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Mark Cached task done' })).toBeDisabled();
  await expect(page.getByTestId('now-done')).toBeDisabled();
  // a screen that loads on demand still opens offline, even one not opened before
  await page.getByTestId('plan-link').click();
  await expect(page.getByLabel('What is tomorrow about')).toBeDisabled();
  await page.getByTestId('tab-tasks').click();
  await expect(page.getByTestId('task-row').filter({ hasText: 'Cached task' })).toBeVisible();
  await context.setOffline(false);
});

test.describe('a screen file that will not load', () => {
  test.use({ serviceWorkers: 'block' }); // a request from the service worker would pass the route below

  test('OF-01b it says so and keeps the app on screen; Try again reloads', async ({ page }) => {
    await page.route('**/assets/Notes-*.js', (r) => r.abort());
    await boot(page, { tables: { os_tasks: [task('First task', { planned_for: TODAY })] } });
    await expect(page.getByTestId('now-card')).toBeVisible();
    await page.goto('/?mock=1#/notes');
    await expect(page.getByTestId('screen-failed')).toContainText('This screen did not open.');
    await expect(page.locator('.tabbar')).toBeVisible();
    // the next screen opens as usual
    await page.getByTestId('tab-tasks').click();
    await expect(page.getByTestId('task-row')).toHaveCount(1);
    await expect(page.getByTestId('screen-failed')).toHaveCount(0);
    await page.goto('/?mock=1#/notes');
    await page.unroute('**/assets/Notes-*.js');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('screen-failed')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Notes' })).toBeVisible();
  });
});

test('OF-02 a habit toggle is disabled offline and sends nothing', async ({ page, context }) => {
  await boot(page, { mode: 'personal', tables: { os_tasks: [task('First task', { planned_for: TODAY })], os_habits: [habitRow('Walk')] } });
  await expect(page.getByRole('checkbox', { name: 'Walk done today' })).toBeEnabled();
  await context.setOffline(true);
  await expect(page.getByRole('checkbox', { name: 'Walk done today' })).toBeDisabled();
  expect((await db(page, 'os_habit_logs')).length).toBe(0);
  await context.setOffline(false);
});

test('OF-03 a window focus refetches', async ({ page }) => {
  await boot(page, { hash: '#/tasks', tables: { os_tasks: [] } });
  await external(page, 'os_tasks', task('From other device'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('task-row').filter({ hasText: 'From other device' })).toBeVisible();
});

test('OF-04 and SH-17 a failed write retries once, reverts and toasts', async ({ page }) => {
  await boot(page, { hash: '#/tasks', tables: { os_tasks: [task('Flaky')] } });
  await expect(page.getByTestId('task-row')).toBeVisible();
  await page.evaluate(() => (window as unknown as { __mock: { setFail(f: object): void } }).__mock.setFail({ writes: 2 }));
  await page.getByRole('checkbox', { name: 'Mark Flaky done' }).click();
  await expect(page.getByText('Not saved. Your change was undone. Try again.')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Mark Flaky done' })).toHaveAttribute('aria-checked', 'false');
  expect((await db<{ status: string }>(page, 'os_tasks'))[0].status).toBe('open');
  await page.getByRole('checkbox', { name: 'Mark Flaky done' }).click();
  await expect.poll(async () => (await db<{ status: string }>(page, 'os_tasks'))[0].status).toBe('done');
});

test('SH-17 a good save toasts Saved', async ({ page }) => {
  await boot(page, { hash: '#/tasks', tables: { os_tasks: [task('Edit')] } });
  await page.getByRole('button', { name: 'Open Edit' }).click();
  await page.getByLabel('Project').fill('x');
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
});

test('OF-05 a failed read shows Could not load with Retry', async ({ page }) => {
  await boot(page, { hash: '#/tasks', fail: { reads: { os_tasks: 1 } }, tables: { os_tasks: [task('Back again')] } });
  await expect(page.getByText('Could not load.')).toBeVisible();
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByTestId('task-row').filter({ hasText: 'Back again' })).toBeVisible();
});

test('OF-06 an idle tab refetches every 5 minutes', async ({ page }) => {
  await boot(page, { hash: '#/tasks', tables: { os_tasks: [] } });
  await expect(page.getByText('No tasks here.')).toBeVisible(); // the screen loads on demand
  await external(page, 'os_tasks', task('Added elsewhere'));
  await page.clock.fastForward('00:05:05');
  await expect(page.getByTestId('task-row').filter({ hasText: 'Added elsewhere' })).toBeVisible();
});

test('OF-07 a snapshot insert refetches the campaigns view', async ({ page }) => {
  await boot(page, { hash: '#/campaigns', tables: { os_campaign_snapshots: [snapRow({ campaign_id: 'E', campaign_name: 'E', sent_total: 10, taken_at: ago(3600_000) })] } });
  await expect(page.getByTestId('camp-row')).toContainText('10');
  await external(page, 'os_campaign_snapshots', snapRow({ campaign_id: 'E', campaign_name: 'E', sent_total: 77, taken_at: ago(0) }), true);
  await expect(page.getByTestId('camp-row')).toContainText('77');
});

test('SH-09 a slow query shows three grey rows without shimmer', async ({ page }) => {
  await boot(page, { hash: '#/tasks', latency: 1500, tables: { os_tasks: [task('Eventually')] } });
  await expect(page.getByTestId('loading-rows').locator('.ph')).toHaveCount(3);
  expect(await page.getByTestId('loading-rows').locator('.ph').first().evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
  await expect(page.getByTestId('task-row')).toBeVisible({ timeout: 15_000 });
});

test('OF-08 sample data chosen and its file will not load: the page still comes up (R4X10)', async ({ page }) => {
  await page.route('**/assets/mock-*.js', (r) => r.abort());
  await page.route(/supabase\.co/, (r) => r.abort());
  await page.addInitScript(() => localStorage.setItem('workos.data', 'mock'));
  await page.goto('/');
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect(page.getByRole('button', { name: /sign in/i }).first()).toBeVisible();
});
