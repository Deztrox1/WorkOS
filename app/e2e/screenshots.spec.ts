/** Not a story test: writes the review screenshots to app/screenshots/ (both widths, both themes). */
import { test } from '@playwright/test';
import { boot } from './helpers';

const SCREENS: [string, string, 'work' | 'personal'][] = [
  ['today-work', '#/', 'work'], ['today-personal', '#/', 'personal'], ['tasks', '#/tasks', 'work'], ['plan', '#/plan', 'work'],
  ['campaigns', '#/campaigns', 'work'], ['finance', '#/finance', 'work'], ['notes', '#/notes', 'work'], ['settings', '#/settings', 'work'],
];
const SIZES: [string, number, number][] = [['390', 390, 844], ['1280', 1280, 800]];

for (const theme of ['light', 'dark'] as const) {
  test(`screenshots ${theme}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme: theme });
    await boot(page, { theme });
    for (const [name, hash, mode] of SCREENS) {
      await page.evaluate((m) => localStorage.setItem('workos.mode', m), mode);
      for (const [w, width, height] of SIZES) {
        await page.setViewportSize({ width, height });
        await page.goto('/' + hash);
        await page.reload();
        await page.waitForTimeout(400);
        await page.screenshot({ path: `screenshots/${name}-${w}-${theme}.png`, fullPage: false });
      }
    }
  });
}
