import { expect, test } from '@playwright/test';
import { boot, day, fin, habitRow, task } from './helpers';

const TODAY = day(0);

test('P4-01 the phone shows a 6 px band rule with no word; every row still tells a screen reader its priority (QA r2 U04, C42)', async ({ page }) => {
  await boot(page, { hash: '#/plan', tables: { os_tasks: [task('Planned one', { planned_for: TODAY }), task('Old one', { due_date: day(-9) }), task('Due one', { due_date: TODAY })] } });
  await expect(page.getByTestId('sheet-row').locator('.band .sr')).toHaveText(['Today', 'Due today']);
  await expect(page.getByTestId('sheet-row').locator('.band .w').first()).toBeHidden();
  const band = await page.getByTestId('sheet-row').first().locator('.band').boundingBox();
  expect(Math.round(band!.width)).toBe(6);
});

test('P4-02 finance: negative profit reads -$333 and a draft invoice is grey and not counted', async ({ page }) => {
  await boot(page, {
    hash: '#/finance',
    tables: { os_finance_entries: [
      fin('Tools', { amount: 333, recurrence: 'monthly' }),
      fin('Draft job', { kind: 'revenue', amount: 1000, source: 'ledger', source_ref: 'INV-X-1', notes: 'draft' }),
    ] },
  });
  await expect(page.getByTestId('fin-profit')).toHaveText('-$333');
  await expect(page.getByTestId('fin-revenue')).toHaveText('$0');
  await expect(page.getByTestId('fin-row-revenue')).toContainText('draft');
  await expect(page.getByTestId('y-tick')).toHaveCount(4);
});

test('P4-03 the habit strip shows 14 weekday letters', async ({ page }) => {
  await boot(page, { hash: '#/habits', mode: 'personal', tables: { os_habits: [habitRow('Walk')] } });
  const strip = page.locator('.strip').first();
  await expect(strip.locator('button')).toHaveCount(14);
  await expect(strip.locator('button > i')).toHaveCount(14);
});
