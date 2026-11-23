/** Fix pass 1, laptop width: two text buttons per row, rail Refresh, campaign filter row and mismatch column, SMS positives. */
import { expect, test } from '@playwright/test';
import { boot, claudeRow, db, day, event, smsDay, snapRow, task, TODAY } from './helpers';

test('3 laptop rows show only the tick and the Ask Claude icon; the rest is in the row menu (QA r1 decision 8)', async ({ page }) => {
  const alpha = task('Alpha', { planned_for: TODAY });
  await boot(page, {
    tables: {
      os_tasks: [alpha, task('Follow up with Fastax', { project: 'sales', source: 'master_sheet', due_date: day(-2), planned_for: TODAY })],
      os_days: [{ day: TODAY, plan: null, review: null, top_task_ids: [alpha.id as string], mood: null }],
    },
  });
  const row = page.getByTestId('plan-row').filter({ hasText: 'Follow up with Fastax' });
  await expect(row.getByRole('checkbox', { name: 'Followed up Follow up with Fastax' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Followed up' })).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Tomorrow', exact: true })).toHaveCount(0);
  await expect(row.getByTestId('ask-claude')).toBeVisible();
  await row.getByRole('button', { name: 'Actions for Follow up with Fastax' }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['Do first', 'Tomorrow', 'Open']);
});

test('3b a row already with Claude is not offered Ask Claude again (QA r2 U10)', async ({ page }) => {
  const held = task('P2', { planned_for: TODAY });
  await boot(page, { hash: '#/plan', tables: { os_tasks: [task('P1', { planned_for: TODAY }), held, task('D1', { due_date: TODAY })], os_claude_requests: [claudeRow('P2', { task_id: held.id })] } });
  await expect(page.getByTestId('sheet-row')).toHaveCount(3); // the screen loads on demand
  await expect(page.getByTestId('sheet-row').filter({ hasText: 'P1' }).getByTestId('ask-claude')).toBeVisible();
  await expect(page.getByTestId('sheet-row').filter({ hasText: 'P2' }).getByTestId('ask-claude')).toHaveCount(0);
});

test('4 every screen can refresh from the rail header', async ({ page }) => {
  await boot(page, { hash: '#/notes', tables: { os_tasks: [] } });
  await expect(page.locator('.rail .rail-foot').getByRole('button', { name: 'Refresh all' })).toBeVisible();
  await page.goto('/?mock=1#/');
  await expect(page.getByRole('button', { name: /Refresh/ })).toHaveCount(1);
});

test('8 campaigns on a laptop: one labelled filter row, mismatch in its own column, Taken at has air', async ({ page }) => {
  await boot(page, { hash: '#/campaigns', tables: { os_campaign_snapshots: [snapRow({ campaign_name: 'E3', status: 'paused', raw: { playbook_status: 'active' }, leads_total: 900 })] } });
  const groups = page.getByTestId('filters').locator('.chip-group');
  await expect(groups.locator('.chip-label')).toHaveText(['Channel', 'Account', 'Status']);
  const tops = await groups.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  const row = page.getByTestId('camp-row');
  await expect(row.locator('td.mm .chip')).toHaveText('playbook differs');
  await expect(row.locator('td').nth(3).locator('.chip:visible')).toHaveCount(0);
  const leads = (await row.locator('td').nth(9).boundingBox())!;
  const taken = (await row.locator('td.taken').boundingBox())!;
  const takenText = await row.locator('td.taken').evaluate((e) => parseFloat(getComputedStyle(e).paddingLeft));
  expect(takenText).toBeGreaterThanOrEqual(16);
  expect(taken.x).toBeGreaterThanOrEqual(leads.x + leads.width);
});

test('9 SMS positives: dash in the table, per account yesterday only in the header, no 30 day sum in the detail', async ({ page }) => {
  await boot(page, {
    hash: '#/campaigns',
    tables: {
      os_campaign_snapshots: [snapRow({ campaign_name: 'Flow', channel: 'sms', account: 'ghl-primary', campaign_id: 'wf1', status: 'published', positives_total: 5, sent_total: null, replies_total: null, bounces_total: null })],
      os_sms_days: [smsDay('ghl-primary', { positives: 3 }), smsDay('ghl-primary', { day: day(-5), positives: 4 }), smsDay('ghl-primary', { day: day(-9), positives: 6 })],
    },
  });
  await expect(page.getByTestId('sms-ghl-primary')).toContainText('3 positives');
  await expect(page.getByTestId('camp-row').getByTestId('positives')).toHaveText('-');
  await page.getByRole('button', { name: 'Flow' }).click();
  const totals = page.getByTestId('detail-totals');
  await expect(totals.locator('div').filter({ has: page.getByText('Positives', { exact: true }) }).locator('dd')).toHaveText('-');
  await expect(page.getByTestId('spark-positives_total')).toContainText('-');
  await expect(page.getByTestId('spark-positives_total')).not.toContainText('13');
});

test('10 mismatch uses the playbook vocabulary', async ({ page }) => {
  const pb = (status: string, playbook: string, id: string) => snapRow({ campaign_name: id, campaign_id: id, status, raw: { playbook_status: playbook } });
  await boot(page, {
    hash: '#/campaigns',
    tables: {
      os_campaign_snapshots: [
        pb('paused', 'parked', 'same1'), pb('draft', 'planned', 'same2'), pb('active', 'in-progress', 'same3'), pb('published', 'active', 'same4'), pb('completed', 'completed', 'same5'),
        pb('paused', 'active', 'diff1'), pb('active', 'parked', 'diff2'), pb('draft', 'completed', 'diff3'),
      ],
    },
  });
  for (const id of ['same1', 'same2', 'same3', 'same4', 'same5']) await expect(page.getByTestId('camp-row').filter({ hasText: id }).locator('td.mm .chip')).toHaveCount(0);
  for (const id of ['diff1', 'diff2', 'diff3']) await expect(page.getByTestId('camp-row').filter({ hasText: id }).locator('td.mm .chip')).toHaveCount(1);
});

test('5 the rail badge passes AA in dark', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await boot(page, { tables: { os_events: [event('Ev1', { severity: 'bad' }), event('Ev2', { severity: 'bad' }), event('Ev3', { severity: 'bad' })] } });
  const badge = page.locator('.rail').getByTestId('feed-badge');
  const ratio = await badge.evaluate((el) => {
    const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const lum = ([a, b, c]: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(a) + 0.7152 * f(b) + 0.0722 * f(c); };
    const cs = getComputedStyle(el);
    const l1 = lum(parse(cs.color)), l2 = lum(parse(cs.backgroundColor));
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
  expect((await db(page, 'os_events')).length).toBe(3);
});
