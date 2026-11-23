/** Stories covered: RM-01 RM-07 RM-11 RM-12 RM-13 RM-15 RM-16 RM-20 RM-21 RM-24 */
import { expect, test, type Page } from '@playwright/test';
import { TODAY, boot, day, db, iso, reminderRow, task } from './helpers';

type R = { title: string; remind_at: string | null; time_local: string | null; repeat: string; repeat_days: number[]; active: boolean; area: string; task_id: string | null; last_fired_at: string | null };
const get = async (page: Page, title: string) => (await db<R>(page, 'os_reminders')).find((r) => r.title === title);

test('RM-01 active first, with next fire and repeat label', async ({ page }) => {
  await boot(page, {
    hash: '#/reminders',
    tables: {
      os_reminders: [
        reminderRow('Inactive one', { repeat: 'daily', time_local: '07:00', active: false }),
        reminderRow('Daily vitamins', { repeat: 'daily', time_local: '09:00' }),
        reminderRow('Plan tomorrow', { repeat: 'daily', time_local: '21:00' }),
      ],
    },
  });
  const rows = page.getByTestId('reminder-item');
  await expect(rows.nth(0)).toContainText('Plan tomorrow');
  await expect(rows.nth(0)).toContainText('Today 21:00');
  await expect(rows.nth(0)).toContainText('Every day');
  await expect(rows.nth(1)).toContainText('Daily vitamins');
  await expect(rows.nth(1)).toContainText('Tomorrow 09:00');
  await expect(rows.nth(2)).toHaveAttribute('data-active', 'false');
});

test('RM-15 and RM-12 create a one-off with a date and time, stored as IST', async ({ page }) => {
  await boot(page, { hash: '#/reminders', tables: {} });
  await page.getByRole('button', { name: 'New' }).click();
  await page.getByLabel('Title').fill('Pay Winnr');
  await page.getByLabel('Date (IST)').fill('2026-10-24');
  await page.getByLabel('Time (IST)', { exact: true }).fill('10:00');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('reminder-item')).toContainText('Sat 10:00');
  const r = (await get(page, 'Pay Winnr'))!;
  expect(r).toMatchObject({ repeat: 'none', area: 'work', active: true });
  expect(r.remind_at).toBe('2026-10-24T04:30:00.000Z');
  expect(await db(page, 'os_reminders')).toHaveLength(1);
});

test('RM-12 a one-off tomorrow reads Tomorrow 15:30', async ({ page }) => {
  await boot(page, { hash: '#/reminders', tables: {} });
  await page.getByRole('button', { name: 'New' }).click();
  await page.getByLabel('Title').fill('Call');
  await page.getByLabel('Date (IST)').fill(day(1));
  await page.getByLabel('Time (IST)', { exact: true }).fill('15:30');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('reminder-item')).toContainText('Tomorrow 15:30');
  expect((await get(page, 'Call'))!.remind_at).toBe(iso(day(1), '15:30'));
});

test('RM-13 a monthly reminder on the 31st shows its clamped fire', async ({ page }) => {
  await boot(page, {
    clock: '2026-11-01T09:00:00+05:30', hash: '#/reminders',
    tables: { os_reminders: [reminderRow('Month end', { repeat: 'monthly', time_local: '08:00', remind_at: iso('2026-10-31', '08:00') })] },
  });
  await expect(page.getByTestId('reminder-item')).toContainText('30 Nov 08:00');
  await page.getByTestId('reminder-item').getByRole('button').click();
  await expect(page.getByLabel('Day of month')).toHaveValue('31');
});

test('RM-07 a reminder that would never fire cannot be saved', async ({ page }) => {
  await boot(page, { hash: '#/reminders', tables: {} });
  await page.getByRole('button', { name: 'New' }).click();
  await page.getByLabel('Title').fill('Dead');
  await page.getByLabel('Repeat').selectOption('custom');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('alert')).toContainText('Pick at least one day');
  await page.getByLabel('Repeat').selectOption('none');
  await page.getByLabel('Date (IST)').fill(TODAY);
  await page.getByLabel('Time (IST)', { exact: true }).fill('08:00');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(await db(page, 'os_reminders')).toHaveLength(0);
});

test('RM-07b a paused one-off reminder still needs a date', async ({ page }) => {
  await boot(page, { hash: '#/reminders', tables: {} });
  await page.getByRole('button', { name: 'New' }).click();
  await page.getByLabel('Title').fill('No date');
  await page.getByRole('checkbox', { name: 'On', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('alert')).toContainText('Pick a date');
  expect(await db(page, 'os_reminders')).toHaveLength(0);
});

test('RM-16 switching a reminder off moves it under the inactive rows', async ({ page }) => {
  await boot(page, { hash: '#/reminders', tables: { os_reminders: [reminderRow('A daily', { repeat: 'daily', time_local: '09:00' }), reminderRow('Other', { repeat: 'daily', time_local: '10:00' })] } });
  await page.getByTestId('reminder-item').filter({ hasText: 'A daily' }).getByRole('button').click();
  await page.getByRole('checkbox', { name: 'On', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('reminder-item').last()).toContainText('A daily');
  await expect(page.getByTestId('reminder-item').last()).toHaveAttribute('data-active', 'false');
});

test('RM-20 the sheet shows the right fields for each repeat type', async ({ page }) => {
  await boot(page, { hash: '#/reminders', tables: {} });
  await page.getByRole('button', { name: 'New' }).click();
  const has = async (l: string) => (await page.getByLabel(l, { exact: true }).count()) + (await page.getByRole('group', { name: l }).count()) > 0;
  const sel = page.getByLabel('Repeat');
  await sel.selectOption('none');
  expect([await has('Date (IST)'), await has('Time (IST)')]).toEqual([true, true]);
  for (const r of ['daily', 'weekdays']) {
    await sel.selectOption(r);
    expect([await has('Time (IST)'), await has('Days'), await has('Day of month')]).toEqual([true, false, false]);
  }
  for (const r of ['weekly', 'custom']) {
    await sel.selectOption(r);
    expect([await has('Time (IST)'), await has('Days')]).toEqual([true, true]);
  }
  await sel.selectOption('monthly');
  expect([await has('Time (IST)'), await has('Day of month'), await has('Days')]).toEqual([true, true, false]);
});

test('RM-24 a reminder can link a task', async ({ page }) => {
  const t = task('Linked task');
  await boot(page, { hash: '#/reminders', tables: { os_tasks: [t] } });
  await page.getByRole('button', { name: 'New' }).click();
  await page.getByLabel('Title').fill('Remind me');
  await page.getByLabel('Date (IST)').fill(day(2));
  await page.getByLabel('Time (IST)', { exact: true }).fill('10:00');
  await page.getByLabel('For task').selectOption({ label: 'Linked task' });
  await expect(page.getByText('For task: Linked task')).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();
  expect((await get(page, 'Remind me'))!.task_id).toBe((t as { id: string }).id);
});

const spyNotifications = async (page: Page, granted = false) =>
  page.addInitScript((granted) => {
    const w = window as unknown as { __notes: string[]; Notification: typeof Notification };
    w.__notes = [];
    const Orig = w.Notification;
    class Spy extends Orig { constructor(t: string, o?: NotificationOptions) { super(t, o); w.__notes.push(t); } }
    if (granted) Object.defineProperty(Spy, 'permission', { get: () => 'granted' });
    w.Notification = Spy;
  }, granted);

test('RM-11 a due one-off shows a banner and a Notification within 5 s and switches itself off', async ({ page }) => {
  await spyNotifications(page, true);
  await boot(page, { tables: { os_reminders: [reminderRow('Stand up', { remind_at: iso(TODAY, '09:02') })] } });
  await expect(page.getByTestId('greeting')).toBeVisible();
  await page.clock.runFor('00:02:05');
  await expect(page.getByTestId('banner-fired')).toContainText('Stand up');
  expect(await page.evaluate(() => (window as unknown as { __notes: string[] }).__notes)).toContain('Stand up');
  await expect.poll(async () => (await get(page, 'Stand up'))?.active).toBe(false);
  expect((await get(page, 'Stand up'))!.last_fired_at).toBeTruthy();
});

test('RM-21 without permission only a banner shows and Settings says Off on every device', async ({ page }) => {
  await spyNotifications(page);
  await boot(page, { tables: { os_reminders: [reminderRow('Stand up', { remind_at: iso(TODAY, '09:02') })] } });
  await expect(page.getByTestId('greeting')).toBeVisible();
  await page.clock.runFor('00:02:05');
  await expect(page.getByTestId('banner-fired')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __notes: string[] }).__notes)).toHaveLength(0);
  await page.goto('/#/settings');
  await expect(page.getByTestId('notif-status')).toHaveText('Off on every device');
});
