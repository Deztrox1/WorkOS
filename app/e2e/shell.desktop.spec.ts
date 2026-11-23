/** Stories covered: SH-02 SH-06 SH-08 SH-10 PL-01, FU-01 */
import { expect, test } from '@playwright/test';
import { boot, day, linkLabels, task } from './helpers';

test('SH-02 a left rail lists every item in groups, theme capsule at the foot, content at most 920 px, and Settings fits at 800 px', async ({ page }) => {
  await boot(page, { hash: '#/tasks' });
  const rail = page.locator('.rail');
  await expect.poll(() => linkLabels(rail.getByRole('navigation', { name: 'Main' }))).toEqual(['Today', 'Plan', 'Tasks', 'Reminders', 'Habits', 'Campaigns', 'Finance', 'Notes', 'Claude', 'Activity', 'Settings']);
  expect(await rail.locator('.rail-group').allTextContents()).toEqual(['The day', 'Work', 'Notes and Claude', 'System']);
  await expect(rail.getByRole('group', { name: 'Mode' })).toHaveCount(0);
  const railBox = (await rail.boundingBox())!;
  const cap = (await rail.getByRole('switch', { name: /^Dark theme/ }).boundingBox())!;
  expect(cap.y).toBeGreaterThan(railBox.height - 120);
  const settings = (await rail.getByTestId('nav-settings').boundingBox())!;
  expect(settings.y + settings.height).toBeLessThanOrEqual(cap.y);
  expect((await page.locator('.content').boundingBox())!.width).toBeLessThanOrEqual(920);
  await expect(page.getByRole('navigation', { name: 'Tabs' })).toBeHidden();
});

test('SH-02c the Add button sits at the top of the rail, its panel opens beside it, and the rail does not jump between screens', async ({ page }) => {
  await boot(page, { hash: '#/tasks' });
  const rail = page.locator('.rail');
  const add = rail.getByTestId('add');
  await expect(page.getByTestId('add')).toHaveCount(1);
  await expect(add).toHaveText('Add');
  const a = (await add.boundingBox())!;
  const today = (await rail.getByTestId('nav-today').boundingBox())!;
  expect(a.y + a.height).toBeLessThanOrEqual(today.y);
  expect(a.height).toBeGreaterThanOrEqual(43.5);
  await add.click();
  const panel = (await page.getByRole('dialog', { name: 'Add' }).boundingBox())!;
  expect(panel.x).toBeLessThan(300);
  expect(panel.y).toBeLessThan(120);
  await page.keyboard.press('Escape');
  await page.goto('/?mock=1#/');
  await expect(page.getByTestId('now-card')).toBeVisible();
  expect((await rail.getByTestId('nav-today').boundingBox())!.y).toBe(today.y);
});

test('SH-02b the rail is the same in Personal mode', async ({ page }) => {
  await boot(page, { mode: 'personal' });
  const rail = page.locator('.rail').getByRole('navigation', { name: 'Main' });
  await expect.poll(() => linkLabels(rail)).toEqual(['Today', 'Plan', 'Tasks', 'Reminders', 'Habits', 'Campaigns', 'Finance', 'Notes', 'Claude', 'Activity', 'Settings']);
});

test('SH-06 the rail starts at 768 px', async ({ page }) => {
  await boot(page);
  await page.setViewportSize({ width: 767, height: 800 });
  await expect(page.getByRole('navigation', { name: 'Tabs' })).toBeVisible();
  await expect(page.locator('.rail')).toBeHidden();
  await page.setViewportSize({ width: 768, height: 800 });
  await expect(page.locator('.rail')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Tabs' })).toBeHidden();
});

test('SH-08 sheets are a 420 px right panel and the list stays visible', async ({ page }) => {
  await boot(page, { tables: { os_tasks: [task('Panel', { planned_for: '2026-10-22' })] } });
  await page.getByTestId('now-title').click();
  const dlg = page.getByRole('dialog', { name: 'Task' });
  await expect.poll(async () => { const b = (await dlg.boundingBox())!; return Math.round(b.x + b.width); }).toBe(1280);
  const s = (await dlg.boundingBox())!;
  expect(Math.round(s.width)).toBe(420);
  await expect(page.getByTestId('now-card')).toBeInViewport();
  const row = (await page.getByTestId('now-card').boundingBox())!;
  expect(row.x + row.width).toBeLessThanOrEqual(s.x + 1);
});

test('SH-10 focus shows a 2 px accent ring with a 2 px offset in order', async ({ page }) => {
  await boot(page, { hash: '#/tasks', tables: { os_tasks: [task('Focus me', { planned_for: '2026-10-22' })] } });
  await expect(page.getByTestId('task-row')).toBeVisible();
  const seen: string[] = [];
  for (let i = 0; i < 8 && seen.length < 6; i++) {
    await page.keyboard.press('Tab');
    const s = await page.evaluate(() => {
      const e = document.activeElement as HTMLElement;
      const c = getComputedStyle(e);
      return { body: e === document.body, label: e.getAttribute('aria-label') || e.textContent || e.tagName, w: c.outlineWidth, o: c.outlineOffset, st: c.outlineStyle };
    });
    if (s.body) continue; // the first Tab from the browser chrome can land on the page itself
    expect(s).toMatchObject({ w: '2px', o: '2px', st: 'solid' });
    seen.push(s.label.trim().slice(0, 12));
  }
  // a skip link first (U21), then the rail: the Add button, then the nav in order
  expect(seen).toEqual(['Skip to the ', 'Add', 'Today', 'Plan', 'Tasks', 'Reminders']);
});

test('SH-10c on the war room there is no mode switch to tab through', async ({ page }) => {
  await boot(page, { tables: { os_tasks: [task('Focus me', { planned_for: '2026-10-22' })] } });
  await expect(page.getByTestId('now-card')).toBeVisible();
  const seen: string[] = [];
  for (let i = 0; i < 8 && seen.length < 4; i++) {
    await page.keyboard.press('Tab');
    const label = await page.evaluate(() => { const e = document.activeElement as HTMLElement; return e === document.body ? null : (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 12); });
    if (label) seen.push(label);
  }
  expect(seen).toEqual(['Skip to the ', 'Add', 'Today', 'Plan']);
});

test('SH-10b the skip link jumps past the rail to the sheet', async ({ page }) => {
  await boot(page, { tables: { os_tasks: [task('Focus me', { planned_for: '2026-10-22' })] } });
  await expect(page.getByTestId('now-card')).toBeVisible();
  await page.keyboard.press('Tab');
  const skip = page.getByRole('button', { name: 'Skip to the page' });
  if (!(await skip.evaluate((e) => e === document.activeElement))) await page.keyboard.press('Tab');
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main#main')).toBeFocused();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('main'))).toBe(true);
});

test('PL-01 review and mood sit side by side on a laptop and stack on a phone', async ({ page }) => {
  await boot(page, { hash: '#/plan', tables: { os_tasks: [] } });
  await expect(page.getByTestId('tomorrow')).toBeVisible();
  await page.setViewportSize({ width: 1024, height: 800 });
  const cols = page.locator('[data-testid="tomorrow"] .two-col > *');
  await expect(cols.nth(1)).toBeVisible(); // the block moves column at 1200 px
  // The block remounts when it moves, so a box read in that moment can be null: read it again until it holds.
  const box = async (n: number) => {
    await expect.poll(() => cols.nth(n).boundingBox()).not.toBeNull();
    return (await cols.nth(n).boundingBox())!;
  };
  const a = await box(0);
  const b = await box(1);
  expect(Math.abs(a.y - b.y)).toBeLessThan(2);
  expect(b.x).toBeGreaterThan(a.x + a.width - 1);
  await page.setViewportSize({ width: 390, height: 844 });
  const a2 = await box(0);
  const b2 = await box(1);
  expect(b2.y).toBeGreaterThan(a2.y + a2.height - 1);
});

test('FU-01 follow-ups appear once on the laptop too', async ({ page }) => {
  await boot(page, { hash: '#/tasks', tables: { os_tasks: [task('Follow up Z', { project: 'sales', source: 'master_sheet', source_ref: 'z', due_date: day(-3) })] } });
  await expect(page.getByTestId('group-overdue').getByTestId('task-row')).toHaveCount(1);
});

test('SH-22d the rail foot capsule flips the theme and the top bar one stays hidden', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await boot(page);
  const cap = page.locator('.rail').getByRole('switch', { name: /^Dark theme/ });
  await expect(page.locator('.topbar')).toBeHidden();
  await expect(cap).toHaveAttribute('aria-checked', 'false');
  await cap.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(cap).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('switch', { name: /^Dark theme/ })).toHaveCount(1); // the hidden twin is not exposed
});

test('SH-02b every rail item sits inside a landmark (R4Y21)', async ({ page }) => {
  await boot(page, { hash: '#/tasks' });
  await expect(page.getByRole('region', { name: 'Menu' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Menu' }).getByTestId('nav-today')).toBeVisible();
});
