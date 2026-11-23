/** Stories covered: CP-05 CP-09 CP-10 CP-13 CP-24 */
import { expect, test, type Page } from '@playwright/test';
import { ago, boot, smsDay, snapRow } from './helpers';

/** Open every folded group (paused, draft, finished, other) in the campaigns ledger. */
async function unfold(page: Page) {
  const closed = page.getByTestId('camp-table').getByRole('button', { expanded: false });
  for (let n = await closed.count(); n > 0; n--) {
    await closed.first().click();
    await expect(closed).toHaveCount(n - 1);
  }
  await expect(closed).toHaveCount(0);
}

test('CP-05 full columns and a name capped at two lines', async ({ page }) => {
  await boot(page, { hash: '#/campaigns', tables: { os_campaign_snapshots: [snapRow({ campaign_name: 'A very long campaign name '.repeat(8), sent_total: 10 })] } });
  await expect(page.locator('table.tbl th:visible')).toHaveText(['Name', 'Channel', 'Account', 'Status', 'Playbook', 'Sent', 'Replies', 'Positives', 'Bounce', 'Leads', 'Checked at']);
  // R3U01: the table fits the paper, so no column is cut at the edge
  const wrap = await page.locator('.tbl-wrap').first().evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth }));
  expect(wrap.sw).toBeLessThanOrEqual(wrap.cw);
  const cell = page.getByTestId('camp-row').locator('td.name');
  expect(await cell.evaluate((e) => getComputedStyle(e.querySelector('button span')!).webkitLineClamp)).toBe('2');
  expect((await cell.boundingBox())!.height).toBeLessThan(70);
});

test('CP-09 positives come from the right source per channel', async ({ page }) => {
  await boot(page, {
    hash: '#/campaigns',
    tables: {
      os_campaign_snapshots: [snapRow({ campaign_name: 'Email', positives_total: 7 }), snapRow({ campaign_name: 'Text', channel: 'sms', account: 'ghl-primary', campaign_id: 'wf', positives_total: null })],
      os_sms_days: [smsDay('ghl-primary', { positives: 3 })],
    },
  });
  await expect(page.getByTestId('camp-row').filter({ hasText: 'Email' }).locator('td').nth(7)).toHaveText('7');
  await expect(page.getByTestId('camp-row').filter({ hasText: 'Text' }).locator('td').nth(7)).toHaveText('-');
});

test('CP-10 SMS rows show status only and published counts as active', async ({ page }) => {
  await boot(page, {
    hash: '#/campaigns',
    tables: { os_campaign_snapshots: [snapRow({ campaign_name: 'Paused one', status: 'paused', campaign_id: 'p' }), snapRow({ campaign_name: 'Flow', channel: 'sms', account: 'ghl-primary', campaign_id: 'wf1', status: 'published', sent_total: null, bounces_total: null })] },
  });
  const first = page.getByTestId('camp-row').first();
  await expect(first).toContainText('Flow');
  await expect(first).toContainText('live');
  await expect(first.locator('td').nth(8)).toHaveText('');
  await expect(first.locator('td').nth(7)).toHaveText('-');
});

test('CP-13 the mismatch chip shows only when the README disagrees', async ({ page }) => {
  await boot(page, {
    hash: '#/campaigns',
    tables: {
      os_campaign_snapshots: [
        snapRow({ campaign_name: 'E3', campaign_id: 'E3', status: 'paused', raw: { playbook_status: 'active' } }),
        snapRow({ campaign_name: 'E1', campaign_id: 'E1', status: 'active', raw: { playbook_status: 'active' } }),
      ],
    },
  });
  await unfold(page);
  await expect(page.getByTestId('camp-row').filter({ hasText: 'E3' })).toContainText('playbook differs');
  await expect(page.getByTestId('camp-row').filter({ hasText: 'E1' })).not.toContainText('playbook differs');
});

test('CP-24 the header and every row show when the numbers were taken', async ({ page }) => {
  await boot(page, { hash: '#/campaigns', tables: { os_campaign_snapshots: [snapRow({ campaign_name: 'A', taken_at: ago(3 * 3600_000 - 55 * 60_000) })] } });
  await expect(page.getByTestId('as-of')).toHaveText('as of 06:55');
  await expect(page.getByTestId('taken-at')).toHaveText('06:55');
});
