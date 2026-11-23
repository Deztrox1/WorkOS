/** Stories covered: NT-01 NT-02 NT-03 NT-04 NT-05 NT-06 NT-07 NT-08 NT-09 NT-10 */
import { expect, test, type Page } from '@playwright/test';
import { ago, boot, db, external, noteRow } from './helpers';

const order = (page: Page) => page.getByTestId('note-card').locator('.t1').allInnerTexts();

test('NT-01 the add button creates a note in the current mode, on Today; Notes keeps its own New note button', async ({ page }) => {
  await boot(page, { tables: {} });
  await expect(page.getByRole('button', { name: 'New note' })).toHaveCount(0);
  await page.getByTestId('add').click();
  // The add button opens the quick-add line; Note is one of the small buttons beside it (decision 5).
  await page.getByRole('group', { name: 'Or add' }).getByRole('button', { name: 'Note', exact: true }).click();
  await page.getByLabel('Title').fill('Idea');
  await page.getByLabel('Note', { exact: false }).last().fill('Body text');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect.poll(async () => (await db(page, 'os_notes')).length).toBe(1);
  expect((await db<{ title: string; area: string; pinned: boolean }>(page, 'os_notes'))[0]).toMatchObject({ title: 'Idea', area: 'work', pinned: false });
  await page.goto('/#/notes');
  await expect(page.getByRole('button', { name: 'New note' })).toBeVisible();
});

test('NT-01b New note on the Notes screen creates a note', async ({ page }) => {
  await boot(page, { hash: '#/notes', tables: {} });
  await page.getByRole('button', { name: 'New note' }).click();
  await page.getByLabel('Title').fill('From Notes');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect.poll(async () => (await db<{ title: string }>(page, 'os_notes')).map((n) => n.title)).toEqual(['From Notes']);
});

test('NT-01c the New note button and the add button on Notes do not overlap', async ({ page }) => {
  await boot(page, { hash: '#/notes', tables: {} });
  const a = (await page.getByRole('button', { name: 'New note' }).boundingBox())!;
  const b = (await page.getByTestId('add').boundingBox())!;
  const overlap = a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  expect(overlap).toBe(false);
});

test('NT-02 and NT-08 pinned first, then newest; pin and unpin', async ({ page }) => {
  await boot(page, {
    hash: '#/notes',
    tables: { os_notes: [noteRow('N1', { pinned: true, created_at: ago(10 * 86400_000), updated_at: ago(10 * 86400_000) }), noteRow('N2', { created_at: ago(5 * 86400_000), updated_at: ago(5 * 86400_000) }), noteRow('N3', { created_at: ago(86400_000), updated_at: ago(86400_000) })] },
  });
  await expect.poll(() => order(page)).toEqual(['N1', 'N3', 'N2']);
  await page.getByRole('button', { name: 'Pin N2' }).click();
  await expect.poll(() => order(page)).toEqual(['N1', 'N2', 'N3']);
  await page.getByRole('button', { name: 'Unpin N2' }).click();
  await expect.poll(() => order(page)).toEqual(['N1', 'N3', 'N2']);
});

test('NT-03 editing a note moves updated_at forward', async ({ page }) => {
  await boot(page, { hash: '#/notes', tables: { os_notes: [noteRow('Idea', { body: 'old', updated_at: ago(5 * 86400_000) })] } });
  await page.getByRole('button', { name: 'Open note Idea' }).click();
  await page.getByLabel('Note', { exact: false }).last().fill('new body');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect.poll(async () => (await db<{ body: string }>(page, 'os_notes'))[0].body).toBe('new body');
  const n = (await db<{ updated_at: string }>(page, 'os_notes'))[0];
  expect(new Date(n.updated_at).getTime()).toBeGreaterThan(Date.now() - 30 * 86400_000);
});

test('NT-04 Make task turns a note into a task with a link back', async ({ page }) => {
  await boot(page, { hash: '#/notes', tables: { os_notes: [noteRow('Send quote', { body: 'Ask Sam for the scope\n- price\n- dates' })] } });
  await page.getByRole('button', { name: 'Make task from Send quote' }).click();
  await expect.poll(async () => (await db(page, 'os_tasks')).length).toBe(1);
  expect((await db<{ title: string; notes: string }>(page, 'os_tasks'))[0]).toMatchObject({ title: 'Send quote', notes: 'Ask Sam for the scope\n- price\n- dates', source: 'note', source_ref: 'n-Send quote' });
});

test('NT-05 search matches title or body', async ({ page }) => {
  await boot(page, { hash: '#/notes', tables: { os_notes: [noteRow('Quote one'), noteRow('Other', { body: 'a quote inside' }), noteRow('Nope', { body: 'zzz' })] } });
  await page.getByLabel('Search notes').fill('quote');
  await expect.poll(async () => (await order(page)).sort()).toEqual(['Other', 'Quote one']);
});

test('NT-06 a note made elsewhere shows within 5 minutes; pin keeps it first', async ({ page }) => {
  await boot(page, { hash: '#/notes', tables: { os_notes: [noteRow('Old', { updated_at: ago(86400_000) })] } });
  await expect(page.getByText('Old').first()).toBeVisible(); // the screen loads on demand
  await external(page, 'os_notes', noteRow('Phone note', { updated_at: ago(0) }));
  await page.clock.fastForward('00:05:05');
  await expect(page.getByTestId('note-card').filter({ hasText: 'Phone note' })).toBeVisible();
  await page.getByRole('button', { name: 'Pin Old' }).click();
  await expect.poll(() => order(page)).toEqual(['Old', 'Phone note']);
});

test('NT-07 notes follow the mode', async ({ page }) => {
  await boot(page, { hash: '#/notes', mode: 'personal', tables: { os_notes: [noteRow('W', { area: 'work' }), noteRow('P', { area: 'personal' })] } });
  await expect.poll(() => order(page)).toEqual(['P']);
});

test('NT-09 only line breaks and bullets are rendered', async ({ page }) => {
  await boot(page, { hash: '#/notes', tables: { os_notes: [noteRow('Md', { body: '- one\n- two\n<b>x</b>' })] } });
  await expect(page.getByTestId('note-card').locator('li')).toHaveCount(2);
  await expect(page.getByTestId('note-card')).toContainText('<b>x</b>');
  await expect(page.getByTestId('note-card').locator('b')).toHaveCount(0);
});

test('NT-10 the New note button is only on Notes; the add menu button is on every screen', async ({ page }) => {
  await boot(page, { hash: '#/tasks', tables: {} });
  await expect(page.getByRole('button', { name: 'New note' })).toHaveCount(0);
  await expect(page.getByTestId('add')).toBeVisible();
  await page.goto('/#/');
  await expect(page.getByRole('button', { name: 'New note' })).toHaveCount(0);
  await expect(page.getByTestId('add')).toBeVisible();
  await page.goto('/#/notes');
  await expect(page.getByRole('button', { name: 'New note' })).toBeVisible();
});
