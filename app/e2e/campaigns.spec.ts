/** Stories covered: CP-01 CP-02 CP-04 CP-06 CP-07 CP-11 CP-16 CP-17 CP-22 CP-23 */
import { expect, test, type Page } from '@playwright/test';
import { TODAY, ago, boot, day, iso, smsDay, snapRow } from './helpers';

/** Open every folded group (paused, draft, finished, other) in the campaigns ledger. */
async function unfold(page: Page) {
  await expect(page.getByTestId('camp-table')).toBeVisible(); // the screen loads on demand
  const closed = page.getByTestId('camp-table').getByRole('button', { expanded: false });
  for (let n = await closed.count(); n > 0; n--) {
    await closed.first().click();
    await expect(closed).toHaveCount(n - 1);
  }
}

test('CP-01 the 44 seeded campaigns list once each', async ({ page }) => {
  await boot(page, { hash: '#/campaigns' });
  await unfold(page);
  await expect(page.getByTestId('camp-row')).toHaveCount(44);
});

test('CP-25 live campaigns come first; paused, draft and finished start folded with a count', async ({ page }) => {
  const mk = (n: string, status: string, over = {}) => snapRow({ campaign_name: n, status, campaign_id: n, ...over });
  await boot(page, { hash: '#/campaigns', tables: { os_campaign_snapshots: [mk('Live A', 'active'), mk('Live B', 'published', { channel: 'sms', account: 'ghl-primary' }), mk('P1', 'paused'), mk('P2', 'paused'), mk('Done', 'completed')] } });
  await expect(page.getByTestId('camp-row').locator('.rowbtn')).toHaveText(['Live A', 'Live B']);
  const paused = page.getByTestId('camp-group-paused');
  await expect(paused).toContainText('Paused');
  await expect(paused).toContainText('2');
  await paused.getByRole('button', { name: /Paused/ }).click();
  await expect(paused.getByTestId('camp-row')).toHaveCount(2);
  await expect(page.getByTestId('camp-group-completed').getByTestId('camp-row')).toHaveCount(0);
});

test('CP-02 header shows the active count and 24 h deltas', async ({ page }) => {
  await boot(page, {
    hash: '#/campaigns',
    tables: {
      os_campaign_snapshots: [
        snapRow({ campaign_id: 'E4', campaign_name: 'E4', sent_total: 100, replies_total: 4, taken_at: ago(30 * 3600_000) }),
        snapRow({ campaign_id: 'E4', campaign_name: 'E4', sent_total: 130, replies_total: 6, taken_at: ago(3600_000) }),
      ],
    },
  });
  await expect(page.getByTestId('h-active')).toHaveText('1');
  await expect(page.getByTestId('h-sent')).toHaveText('30');
  await expect(page.getByTestId('h-replies')).toHaveText('2');
});

test('CP-04 SMS yesterday per account with a capped chip', async ({ page }) => {
  await boot(page, {
    hash: '#/campaigns',
    tables: {
      os_campaign_snapshots: [snapRow({ campaign_name: 'E' })],
      os_sms_days: [smsDay('ghl-primary', { sent: 120, replies: 9, positives: 3, stops: 8, capped: true }), smsDay('ghl-second', { sent: 40, replies: 2, positives: 1, stops: 0 })],
    },
  });
  const a = page.getByTestId('sms-ghl-primary');
  await expect(a).toContainText('120 sent, 9 replies, 3 positives, 8 said stop');
  await expect(a).toContainText('capped');
  const b = page.getByTestId('sms-ghl-second');
  await expect(b).toContainText('40 sent, 2 replies, 1 positive, 0 said stop');
  await expect(b).not.toContainText('capped');
});

test('CP-06 a phone shows only name, status, sent, replies, bounce', async ({ page }) => {
  await boot(page, { hash: '#/campaigns' });
  await expect(page.locator('table.tbl th:visible').first()).toBeVisible(); // the screen loads on demand
  const heads = await page.locator('table.tbl th:visible').allTextContents();
  expect(heads).toEqual(['Name', 'Status', 'Sent', 'Replies', 'Bounce']);
});

test('CP-07 rows sort by status group then name', async ({ page }) => {
  const mk = (n: string, status: string, over = {}) => snapRow({ campaign_name: n, status, campaign_id: n, ...over });
  await boot(page, {
    hash: '#/campaigns',
    tables: {
      os_campaign_snapshots: [mk('Z done', 'completed'), mk('B pause', 'paused'), mk('A draft', 'draft'), mk('Y live', 'published', { channel: 'sms', account: 'ghl-primary' }), mk('M live', 'active'), mk('Q odd', 'weird')],
    },
  });
  await unfold(page);
  await expect(page.getByTestId('camp-table')).toBeVisible(); // the screen loads on demand
  const names = await page.getByTestId('camp-row').locator('.rowbtn').allInnerTexts();
  expect(names).toEqual(['M live', 'Y live', 'B pause', 'A draft', 'Z done', 'Q odd']);
});

const e4 = () => [
  snapRow({ campaign_id: 'E4', campaign_name: 'E4', sent_total: 100, replies_total: 4, positives_total: 1, taken_at: iso(day(-1), '08:00') }),
  snapRow({ campaign_id: 'E4', campaign_name: 'E4', sent_total: 130, replies_total: 6, positives_total: 2, taken_at: iso(TODAY, '08:00') }),
  snapRow({ campaign_id: 'E1', campaign_name: 'E1', sent_total: 150, replies_total: 6, positives_total: 2, bounces_total: 9, opens_total: 80, leads_total: 300, raw: { playbook_status: 'active' } }),
];

test('CP-11 CP-22 CP-23 row detail: sparklines, totals, playbook, links', async ({ page }) => {
  await boot(page, { hash: '#/campaigns', tables: { os_campaign_snapshots: e4() } });
  await page.getByRole('button', { name: 'E4' }).click();
  for (const k of ['sent_total', 'replies_total', 'positives_total']) await expect(page.getByTestId(`spark-${k}`).getByTestId('spark')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'E1' }).click();
  await expect(page.getByTestId('spark-sent_total')).toContainText('no data');
  const t = page.getByTestId('detail-totals');
  for (const [l, v] of [['Sent', '150'], ['Replies', '6'], ['Positives', '2'], ['Bounces', '9'], ['Opens', '80'], ['Leads', '300']]) await expect(t.locator('div').filter({ has: page.getByText(l, { exact: true }) })).toContainText(v);
  await expect(page.getByTestId('playbook')).toHaveText('live');
  await expect(page.getByRole('link', { name: 'Open the playbook' })).toHaveAttribute('href', /cold-outreach/);
  await expect(page.getByTestId('ext-link')).toHaveAttribute('href', 'https://app.instantly.ai/app/campaign/E1');
});

test('CP-16 the screen is read only', async ({ page }) => {
  await boot(page, { hash: '#/campaigns', tables: { os_campaign_snapshots: e4() } });
  await page.getByRole('button', { name: 'E1' }).click();
  for (const n of [/pause/i, /edit/i, /create/i, /request change/i]) await expect(page.getByRole('button', { name: n })).toHaveCount(0);
});

test('CP-17 filter chips narrow the table and clear', async ({ page }) => {
  const rows = [
    snapRow({ campaign_name: 'A', channel: 'email', account: 'instantly', status: 'paused' }),
    snapRow({ campaign_name: 'B', channel: 'email', account: 'instantly', status: 'active' }),
    snapRow({ campaign_name: 'C', channel: 'sms', account: 'ghl-primary', status: 'published' }),
  ];
  await boot(page, { hash: '#/campaigns', tables: { os_campaign_snapshots: rows } });
  const f = (g: string, n: string) => page.getByRole('group', { name: g }).getByRole('button', { name: n });
  const filter = page.getByRole('button', { name: /^Filter/ });
  await expect(page.getByTestId('camp-table')).toBeVisible(); // the screen loads on demand
  if (await filter.isVisible()) await filter.click();
  await f('Channel', 'Email').click();
  await f('Account', 'Instantly').click();
  await f('Status', 'Paused').click();
  await expect(page.getByTestId('camp-row')).toHaveCount(1);
  await f('Status', 'Paused').click();
  await expect(page.getByTestId('camp-row')).toHaveCount(2);
});
