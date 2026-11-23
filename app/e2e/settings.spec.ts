/** Stories covered: ST-01 ST-02 ST-03 ST-05 ST-06 ST-08 ST-09 ST-10 ST-11 ST-13 ST-14 ST-15 PU-08 */
import { expect, test } from '@playwright/test';
import { ago, boot, db, event, fin, reminderRow, settings, snapRow, task } from './helpers';

const bal = (value: number, limit: number | null, hoursAgo = 5) => ({ value, limit, taken_at: ago(hoursAgo * 3600_000) });

test('ST-01 email shows and Sign out returns to Sign in', async ({ page }) => {
  await boot(page, { hash: '#/settings' });
  await expect(page.getByTestId('account-email')).toHaveText('owner@example.com');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/#\/signin/);
  await page.goto('/#/');
  await expect(page).toHaveURL(/#\/signin/);
});

test('ST-02 the default mode applies on a first visit and the timezone is read only', async ({ page }) => {
  await boot(page, { mode: null, hash: '#/tasks', tables: { os_settings: settings({ default_mode: 'personal' }) as never, os_tasks: [task('W'), task('P', { area: 'personal', planned_for: '2026-10-22' })] } });
  await expect(page.getByRole('button', { name: 'Personal' }).first()).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/#/settings');
  await page.getByTestId('sys-details').locator('summary').click();
  await expect(page.locator('dl.kv').filter({ hasText: 'Timezone' }).locator('dd', { hasText: 'Asia/Kolkata' })).toBeVisible();
  await expect(page.getByLabel('Timezone')).toHaveCount(0); // read only text, not a field
});

test('ST-03 Enable registers the service worker and saves the device', async ({ page }) => {
  await page.context().grantPermissions(['notifications'], { origin: 'http://127.0.0.1:4173' });
  await boot(page, { hash: '#/settings' });
  await page.evaluate(() => Notification.requestPermission());
  await page.getByLabel('This device').fill('Pixel');
  await page.getByRole('button', { name: 'Enable on this device' }).click();
  await expect.poll(async () => (await db<{ device_label: string }>(page, 'os_push_subscriptions')).length).toBe(1);
  expect((await db<{ device_label: string }>(page, 'os_push_subscriptions'))[0].device_label).toBe('Pixel');
  expect(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()))).toBe(true);
  await expect(page.getByTestId('notif-status')).toHaveText('On, 1 device');
});

test('PU-08 a denied permission saves nothing and says Off on every device', async ({ page }) => {
  await boot(page, { hash: '#/settings' });
  await page.getByRole('button', { name: 'Enable on this device' }).click();
  expect(await db(page, 'os_push_subscriptions')).toHaveLength(0);
  await expect(page.getByTestId('notif-status')).toHaveText('Off on every device');
  await expect(page.getByText('Allow notifications for this site')).toBeVisible();
});

test('ST-14 a device can be removed', async ({ page }) => {
  await boot(page, { hash: '#/settings', tables: { os_push_subscriptions: [{ endpoint: 'mock://d1', p256dh: 'x', auth: 'y', device_label: 'Pixel', created_at: ago(0) }] } });
  await expect(page.getByTestId('device-row')).toContainText('Pixel');
  await page.getByRole('button', { name: 'Remove Pixel' }).click();
  await expect(page.getByTestId('device-row')).toHaveCount(0);
  expect(await db(page, 'os_push_subscriptions')).toHaveLength(0);
});

test('ST-05 ST-06 ST-15 balance tiles: value of limit, low in red, no total', async ({ page }) => {
  await boot(page, {
    hash: '#/settings',
    tables: { os_settings: settings({ balances: { consulti: bal(3200, 10000), vendora: bal(900, 10000), vendorc: bal(1000, 10000), vendorb: bal(50, null), numlookup: bal(100, null) }, balance_limits: { numlookup: 5000 } }) as never },
  });
  await expect(page.getByTestId('bal-consulti')).toContainText('3,200');
  await expect(page.getByTestId('bal-consulti')).toContainText('of 10,000');
  await expect(page.getByTestId('bal-consulti')).toContainText('checked');
  await expect(page.getByTestId('bal-vendora')).toHaveAttribute('data-low', 'true');
  await expect(page.getByTestId('bal-vendora')).toContainText('low');
  await expect(page.getByTestId('bal-vendorc')).toHaveAttribute('data-low', 'false');
  await expect(page.getByTestId('bal-vendorb')).toContainText('50 left');
  await expect(page.getByTestId('bal-vendorb')).toHaveAttribute('data-low', 'false');
  await expect(page.getByTestId('bal-numlookup')).toContainText('of 5,000');
  await expect(page.getByTestId('bal-numlookup')).toHaveAttribute('data-low', 'true');
});

test('ST-16 a balance row takes a renewal date and keeps it', async ({ page }) => {
  await boot(page, { hash: '#/settings', tables: { os_settings: settings({ balances: { consulti: bal(3200, 10000) } }) as never } });
  const row = page.getByTestId('bal-consulti');
  await row.getByLabel('Consulti renews on').fill('2026-11-15');
  await page.getByRole('heading', { name: 'Money' }).click(); // leave the field: it saves on blur
  await expect(row).toContainText('renews 2026-11-15');
  const stored = (await db<{ key: string; value: Record<string, string> }>(page, 'os_settings')).find((r) => r.key === 'balance_renewals');
  expect(stored?.value).toEqual({ consulti: '2026-11-15' });
});

test('ST-17 the password needs 12 characters before Change password is enabled', async ({ page }) => {
  await boot(page, { hash: '#/settings' });
  await page.getByLabel('New password').fill('short-11-ch');
  await expect(page.getByRole('button', { name: 'Change password' })).toBeDisabled();
  await page.getByLabel('New password').fill('twelve-chars');
  await expect(page.getByRole('button', { name: 'Change password' })).toBeEnabled();
});

test('ST-18 Look: the theme choice sets data-theme, System clears it', async ({ page }) => {
  await boot(page, { hash: '#/settings' });
  const html = page.locator('html');
  const theme = page.getByRole('group', { name: 'Theme' });
  await theme.getByRole('button', { name: 'Dark' }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await theme.getByRole('button', { name: 'Light' }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await theme.getByRole('button', { name: 'System' }).click();
  await expect(html).not.toHaveAttribute('data-theme', /.+/);
});

test('ST-19 the default mode choice is saved to os_settings', async ({ page }) => {
  await boot(page, { hash: '#/settings' });
  await page.getByRole('group', { name: 'Default mode' }).getByRole('button', { name: 'Personal' }).click();
  await expect.poll(async () => (await db<{ key: string; value: string }>(page, 'os_settings')).find((r) => r.key === 'default_mode')?.value).toBe('personal');
});

test('ST-08 change password', async ({ page }) => {
  await boot(page, { hash: '#/settings' });
  await page.getByLabel('New password').fill('a-new-secret');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Password changed')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('workos.mock.password'))).toBe('a-new-secret');
});

test('ST-08b after a password change every other device stops getting notifications; this one stays (R2S10)', async ({ page }) => {
  const sub = (endpoint: string, label: string) => ({ endpoint, p256dh: 'x', auth: 'y', device_label: label, created_at: ago(0) });
  await boot(page, { hash: '#/settings', tables: { os_push_subscriptions: [sub('mock://mine', 'This laptop'), sub('mock://stolen', 'Unknown phone')] } });
  await page.evaluate(() => localStorage.setItem('workos.push.endpoint', 'mock://mine'));
  await page.getByLabel('New password').fill('a-new-secret');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Password changed. Notifications on your other devices are off.')).toBeVisible();
  const left = await db<{ endpoint: string }>(page, 'os_push_subscriptions');
  expect(left.map((d) => d.endpoint)).toEqual(['mock://mine']);
});

test('ST-08c a password error says what to do and shows nothing from the server (R2C40)', async ({ page }) => {
  await boot(page, { hash: '#/settings' });
  await page.getByLabel('New password').fill('twelve-chars');
  await page.evaluate(() => { localStorage.setItem('workos.mock.password', ''); });
  // the sample client refuses short passwords; make it refuse this one
  await page.evaluate(() => { const o = Storage.prototype.setItem; Storage.prototype.setItem = function (k: string, v: string) { if (k === 'workos.mock.password') throw new Error('Password should be at least 6 characters.'); return o.call(this, k, v); }; });
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Could not change the password. Try a longer one.')).toBeVisible();
  await expect(page.getByText('Password should be')).toHaveCount(0);
});

test('ST-09 version, last collector run and last heartbeat', async ({ page }) => {
  await boot(page, {
    hash: '#/settings',
    tables: { os_settings: settings({ heartbeat_state: { updated_at: ago(2 * 3600_000) } }) as never, os_campaign_snapshots: [snapRow({ taken_at: ago(3 * 3600_000 - 55 * 60_000) })] },
  });
  await expect(page.getByTestId('app-version')).toHaveText('1.0.0');
  await expect(page.getByTestId('last-collector')).toHaveText('06:55');
  await expect(page.getByTestId('last-heartbeat')).toHaveText('07:00');
});

test('ST-10 push late shows first, details open; all fine folds the details away', async ({ page }) => {
  await boot(page, { hash: '#/settings', tables: { os_settings: settings({ push_last_run: ago(6 * 60_000) }) as never } });
  await expect(page.getByTestId('push-late')).toHaveText('Reminders may come late. The sender has not run for 5 minutes.');
  await expect(page.getByTestId('sys-details')).toHaveAttribute('open', '');
  const p2 = await page.context().newPage();
  await p2.setViewportSize({ width: 390, height: 844 });
  await boot(p2, { hash: '#/settings', tables: { os_settings: settings({ push_last_run: ago(2 * 60_000) }) as never } });
  await expect(p2.getByRole('heading', { name: 'System' })).toBeVisible();
  await expect(p2.getByTestId('push-late')).toHaveCount(0);
  await expect(p2.getByTestId('sys-ok')).toBeVisible();
  await expect(p2.getByTestId('sys-details')).not.toHaveAttribute('open', '');
});

test('ST-11 Export my data downloads every table except device keys', async ({ page }) => {
  await boot(page, { hash: '#/settings', tables: { os_tasks: [task('X')], os_finance_entries: [fin('F')], os_events: [event('E')] } });
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export my data' }).click();
  const d = await dl;
  expect(d.suggestedFilename()).toBe('workos-export.json');
  const body = JSON.parse(await (await import('node:fs/promises')).readFile((await d.path())!, 'utf8')) as Record<string, unknown[]>;
  for (const t of ['os_tasks', 'os_reminders', 'os_days', 'os_habits', 'os_habit_logs', 'os_events', 'os_campaign_snapshots', 'os_settings', 'os_notes', 'os_finance_entries', 'os_sms_days', 'os_claude_requests']) expect(body).toHaveProperty(t);
  expect(body).not.toHaveProperty('os_push_subscriptions'); // device keys never leave the account
  expect(body.os_tasks).toHaveLength(1);
});

test('ST-11b Export my data reads every table in pages: 1,500 tasks all come out (Q20)', async ({ page }) => {
  const many = Array.from({ length: 1500 }, (_, i) => task(`Bulk ${String(i).padStart(4, '0')}`));
  await boot(page, { hash: '#/settings', tables: { os_tasks: many } });
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export my data' }).click();
  const body = JSON.parse(await (await import('node:fs/promises')).readFile((await (await dl).path())!, 'utf8')) as Record<string, { id: string }[]>;
  expect(body.os_tasks).toHaveLength(1500);
  expect(new Set(body.os_tasks.map((t) => t.id)).size).toBe(1500);
});

test('ST-13 four links open in a new tab', async ({ page }) => {
  await boot(page, { hash: '#/settings' });
  const links = page.getByTestId('links').getByRole('link');
  await expect(links).toHaveCount(4);
  for (const l of await links.all()) await expect(l).toHaveAttribute('target', '_blank');
});

test('System block shows the data mode and offers live data', async ({ page }) => {
  await boot(page, { hash: '#/settings', tables: { os_reminders: [reminderRow('x')] } });
  await expect(page.getByTestId('data-mode')).toHaveText('Sample data in this browser');
  await expect(page.getByRole('button', { name: 'Use live data' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use sample data' })).toHaveCount(0);
  await expect(page.getByLabel('Supabase URL')).toHaveCount(0);
  await expect(page.getByLabel(/Supabase/)).toHaveCount(0);
});

test('Claude Code section says it does not start by itself yet, with a one-line how-to link', async ({ page }) => {
  await boot(page, { hash: '#/settings' });
  await expect(page.getByText('Starts by itself')).toBeVisible();
  await expect(page.getByTestId('routine-link')).toHaveText('not yet');
  await expect(page.getByText('Last started')).toBeVisible();
  const how = page.getByRole('link', { name: 'How to set this up' });
  await expect(how).toHaveAttribute('target', '_blank');
  expect((await how.boundingBox())!.height).toBeGreaterThanOrEqual(43.5); // R2U26
  await expect(page.getByText('install script')).toHaveCount(0);
});

test('Claude Code section reads yes once the sender is set up', async ({ page }) => {
  await boot(page, { hash: '#/settings', tables: { os_settings: settings({ claude_routine: { linked: true } }) as never } });
  await expect(page.getByTestId('routine-link')).toHaveText('yes');
  await expect(page.getByText('Ask Claude on any task and it starts within a minute.')).toBeVisible();
});

test('System says No checks have run yet. when nothing has run, never All fine (R2C16)', async ({ page }) => {
  await boot(page, { hash: '#/settings', tables: { os_settings: settings() as never } });
  await expect(page.getByTestId('sys-none')).toHaveText('No checks have run yet.');
  await expect(page.getByTestId('sys-ok')).toHaveCount(0);
});

test('Settings sits on the paper sheet with every approved section, ruled caps heads, and no developer words (R2U03)', async ({ page }) => {
  await boot(page, { hash: '#/settings' });
  await expect(page.locator('.sheetpaper.page.settings-page')).toHaveCount(1);
  await expect(page.locator('.settings-page .sec-h h2')).toHaveText(['Look', 'Notifications', 'Balances', 'Money', 'Google Calendar', 'Claude Code', 'Links', 'Account', 'System']);
  expect(await page.locator('.settings-page .sec-h h2').first().evaluate((e) => getComputedStyle(e).textTransform)).toBe('uppercase');
  const text = (await page.locator('.settings-page').innerText()).toLowerCase();
  for (const w of ['routine', 'queue', 'collector', 'heartbeat', 'synced', 'capsule', 'token', 'supabase']) expect(text).not.toContain(w);
  await expect(page.getByRole('button', { name: 'Use live data' })).toBeVisible(); // the sample-data switch stays, apart from the rest
});

test('balance names read as people say them', async ({ page }) => {
  await boot(page, { hash: '#/settings', tables: { os_settings: settings({ balances: { millionverifier: bal(5000, 10000), numlookup: bal(10, 100) } }) as never } });
  await expect(page.getByTestId('bal-millionverifier')).toContainText('MillionVerifier');
  await expect(page.getByTestId('bal-numlookup')).toContainText('NumLookup');
  const link = page.getByTestId('bal-millionverifier').getByRole('link');
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
});

test('Use sample data is a Settings switch; a ?mock=1 link alone does nothing on a production build (Q15)', async ({ page }) => {
  // the preview build is production: without the stored choice, ?mock=1 must not switch data
  await page.addInitScript(() => { if (!sessionStorage.getItem('q15')) { sessionStorage.setItem('q15', '1'); localStorage.clear(); } });
  await page.goto('/?mock=1#/signin');
  expect(await page.evaluate(() => localStorage.getItem('workos.data'))).toBeNull();
});
