/** Ask Claude on a laptop: the icon button on the row; everything else sits in the row menu (QA r1 decision 8). */
import { expect, test } from '@playwright/test';
import { TODAY, boot, db, settings, task } from './helpers';

test('CL-01d the Ask Claude icon on a task row queues a request (linked) that shows on /claude', async ({ page }) => {
  const t = task('Draft the Sam quote', { planned_for: TODAY });
  await boot(page, { tables: { os_settings: settings({ claude_routine: { linked: true } }) as never, os_tasks: [t] } });
  const row = page.getByTestId('now-card');
  await row.getByRole('button', { name: 'Actions for Draft the Sam quote' }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['Tomorrow', 'Open']); // Ask Claude is the icon, not a menu item
  await page.keyboard.press('Escape');
  await row.getByTestId('ask-claude').click();
  const dlg = page.getByRole('dialog', { name: 'Ask Claude' });
  await expect(dlg.getByLabel('Brief')).toContainText('Draft the Sam quote');
  await dlg.getByTestId('claude-send').click();
  await expect(page.getByText('Sent. Claude starts within a minute.')).toBeVisible();
  const rows = await db<{ title: string; status: string; task_id: string }>(page, 'os_claude_requests');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ title: 'Draft the Sam quote', status: 'queued', handoff: 'routine', task_id: t.id });
  await page.getByTestId('nav-claude').click();
  await expect(page).toHaveURL(/#\/claude/);
  await expect(page.getByTestId('claude-item')).toHaveCount(1);
  await expect(page.getByTestId('claude-item')).toContainText('Draft the Sam quote');
});

test('CL-06 the Ask Claude icon is also on Tasks rows and has a name', async ({ page }) => {
  await boot(page, { hash: '#/tasks', tables: { os_tasks: [task('On tasks')] } });
  await page.getByRole('button', { name: 'Ask Claude about On tasks' }).click();
  await expect(page.getByRole('dialog', { name: 'Ask Claude' })).toBeVisible();
});
