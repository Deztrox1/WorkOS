/** Stories covered: FN-01 FN-03 FN-04 FN-05 FN-06 FN-07 FN-08 FN-09 FN-10 FN-11 FN-13 FN-14 FN-15 FN-16, ST-12 */
import { expect, test, type Page } from '@playwright/test';
import { boot, db, fin, settings } from './helpers';

const costs = () => [
  fin('AI tools', { amount: 118, recurrence: 'monthly' }), fin('Inboxes', { amount: 69, recurrence: 'monthly' }),
  fin('SIM plan', { amount: 16, recurrence: 'monthly' }), fin('Work mail', { amount: 3, recurrence: 'monthly' }),
  fin('Instantly', { amount: 107, recurrence: 'monthly', month: '2026-10-01' }),
];
const invoice = (amount = 1226, over = {}) => fin('Maple Court', { kind: 'revenue', amount, source: 'ledger', source_ref: 'INV-MC-00001', notes: 'sent', ...over });
const sheetSave = async (page: Page) => page.getByRole('button', { name: 'Save' }).click();
const month = (page: Page, label: string) => page.getByLabel('Month', { exact: true }).selectOption({ label });

test('FN-01 and FN-14 October shows costs, the client invoice and profit in colour with a word', async ({ page }) => {
  await boot(page, { hash: '#/finance', tables: { os_finance_entries: [...costs(), invoice(1313)] } });
  await expect(page.getByTestId('fin-row-cost')).toHaveCount(5);
  await expect(page.getByTestId('fin-costs')).toHaveText('$313');
  await expect(page.getByTestId('fin-revenue')).toHaveText('$1,313');
  await expect(page.getByTestId('fin-profit')).toHaveText('$1,000');
  await expect(page.getByTestId('fin-status')).toHaveText('on target');
  await expect(page.getByTestId('fin-profit')).toHaveClass(/good/);
});

test('FN-14 profit under target is red with a word', async ({ page }) => {
  await boot(page, { hash: '#/finance', tables: { os_finance_entries: [...costs(), invoice(900)] } });
  await expect(page.getByTestId('fin-profit')).toHaveText('$587');
  await expect(page.getByTestId('fin-status')).toHaveText('under target');
  await expect(page.getByTestId('fin-profit')).toHaveClass(/bad/);
});

test('FN-03 and FN-16 own currency per row and a USD total from the Settings rate', async ({ page }) => {
  const tables = { os_finance_entries: [fin('INR job', { kind: 'revenue', amount: 840, currency: 'INR' }), fin('GBP job', { kind: 'revenue', amount: 100, currency: 'GBP' })] };
  await boot(page, { hash: '#/finance', tables });
  const list = page.getByTestId('fin-row-revenue').filter({ hasText: 'INR job' });
  await expect(list).toContainText('840 INR');
  await expect(page.getByTestId('fin-row-revenue').filter({ hasText: 'GBP job' })).toContainText('100 GBP');
  await expect(page.getByTestId('fin-usd-total')).toHaveText('USD total $140');
  await page.goto('/#/settings');
  await page.getByLabel('1 USD in INR').fill('80');
  await page.getByRole('button', { name: 'Save rates' }).click();
  await expect.poll(async () => ((await db<{ key: string; value: { INR: number } }>(page, 'os_settings')).find((s) => s.key === 'fx')?.value.INR)).toBeCloseTo(1 / 80);
  await page.goto('/#/finance');
  await expect(page.getByTestId('fin-usd-total')).toHaveText('USD total $140.5');
});

test('FN-04 FN-07 FN-09 add, edit and delete a one-time cost', async ({ page }) => {
  await boot(page, { hash: '#/finance', tables: { os_finance_entries: costs() } });
  await expect(page.getByTestId('fin-costs')).toHaveText('$313');
  await page.getByRole('button', { name: 'Add cost' }).click();
  await page.getByLabel('Label').fill('Domain');
  await page.getByLabel('Amount').fill('20');
  await sheetSave(page);
  await expect(page.getByTestId('fin-costs')).toHaveText('$333');
  await page.getByRole('button', { name: 'Edit Domain' }).click();
  await page.getByLabel('Label').fill('Domain renewal');
  await page.getByLabel('Amount').fill('22');
  await sheetSave(page);
  await expect(page.getByTestId('fin-costs')).toHaveText('$335');
  await expect(page.getByTestId('fin-row-cost').filter({ hasText: 'Domain renewal' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit Domain renewal' }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect((await db(page, 'os_finance_entries')).length).toBe(6);
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect.poll(async () => (await db(page, 'os_finance_entries')).length).toBe(5);
});

test('FN-05 and FN-10 ledger invoices show with status and can be marked paid', async ({ page }) => {
  await boot(page, { hash: '#/finance', tables: { os_finance_entries: [invoice(1200, { label: 'Maple Court', source_ref: 'INV-X' })] } });
  const r = page.getByTestId('fin-row-revenue').filter({ hasText: 'INV-X' });
  await expect(r).toContainText('Maple Court');
  await expect(r).toContainText('1,200');
  await expect(r).toContainText('USD');
  await expect(r).toContainText('status sent');
  await page.getByRole('button', { name: 'Mark paid' }).click();
  await expect(r).toContainText('status paid');
});

test('FN-11 a manual revenue entry adds to the USD total', async ({ page }) => {
  await boot(page, { hash: '#/finance', tables: { os_finance_entries: [] } });
  await page.getByRole('button', { name: 'Add revenue' }).click();
  await page.getByLabel('Label').fill('Workshop');
  await page.getByLabel('Amount').fill('500');
  await page.getByLabel('Currency').selectOption('GBP');
  await sheetSave(page);
  await expect(page.getByTestId('fin-usd-total')).toHaveText('USD total $650');
  await page.getByRole('button', { name: 'Edit Workshop' }).click();
  await page.getByLabel('Amount').fill('600');
  await sheetSave(page);
  await expect(page.getByTestId('fin-usd-total')).toHaveText('USD total $780');
});

test('FN-08 ending a recurring cost removes it after its end month', async ({ page }) => {
  await boot(page, { hash: '#/finance', tables: { os_finance_entries: [fin('Tool', { amount: 50, recurrence: 'monthly' })] } });
  await page.getByRole('button', { name: 'Edit Tool' }).click();
  await page.getByLabel('End month').fill('2026-12');
  await sheetSave(page);
  await month(page, 'Dec 2026');
  await expect(page.getByTestId('fin-row-cost')).toHaveCount(1);
  await month(page, 'Jan 2027');
  await expect(page.getByTestId('fin-row-cost')).toHaveCount(0);
});

test('FN-13 and FN-15 the month picker and recurring starts', async ({ page }) => {
  await boot(page, { hash: '#/finance', tables: { os_finance_entries: [...costs(), fin('Sep job', { kind: 'revenue', amount: 400, month: '2026-09-01' })] } });
  await expect(page.getByTestId('fin-costs')).toHaveText('$313');
  await month(page, 'Nov 2026');
  await expect(page.getByTestId('fin-costs')).toHaveText('$313');
  await month(page, 'Sep 2026');
  await expect(page.getByTestId('fin-revenue').first()).toHaveText('$400');
  await expect(page.getByTestId('fin-costs')).toHaveText('$0');
});

test('FN-06 a 12 month chart with a profit line and a target line', async ({ page }) => {
  const entries: Record<string, unknown>[] = [];
  for (let m = 0; m < 12; m++) {
    const d = new Date(Date.UTC(2025, 10 + m, 1));
    const mo = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
    entries.push(fin(`rev${m}`, { kind: 'revenue', amount: 500 + m * 100, month: mo }), fin(`cost${m}`, { amount: 200, month: mo }));
  }
  await boot(page, { hash: '#/finance', tables: { os_finance_entries: entries } });
  await expect(page.getByTestId('fin-month')).toHaveCount(12);
  await expect(page.getByTestId('fin-chart').locator('g[data-testid="fin-month"] path')).toHaveCount(24);
  await expect(page.getByTestId('profit-line')).toBeVisible();
  await expect(page.getByTestId('target-line')).toBeAttached();
  await expect(page.getByTestId('fin-month').first().locator('text').first()).toHaveText('Nov');
  await expect(page.getByTestId('fin-chart').getByText('2026', { exact: true })).toHaveCount(1);
  await expect(page.getByTestId('fin-chart').getByText('Jan', { exact: true })).toHaveCount(1);
  await expect(page.getByTestId('target-label')).toHaveText('target $1,000');
});

test('FN-06b the last profit label shows the last month profit and a tap shows a tooltip', async ({ page }) => {
  await boot(page, { hash: '#/finance', tables: { os_finance_entries: [...costs(), invoice(1313)] } });
  await expect(page.getByTestId('profit-last')).toHaveText('$1,000');
  await page.getByTestId('month-hit').last().click();
  await expect(page.getByTestId('fin-tip')).toContainText('Profit $1,000');
  await expect(page.getByTestId('fin-tip')).toContainText('Revenue $1,313');
});

test('ST-12 the settings page keeps the rate in USD per unit', async ({ page }) => {
  await boot(page, { hash: '#/settings', tables: { os_settings: settings({ fx: { USD: 1, INR: 1 / 84, GBP: 1.3 } }) as never } });
  await expect(page.getByLabel('1 USD in INR')).toHaveValue('84');
  await expect(page.getByLabel('1 GBP in USD')).toHaveValue('1.3');
});
