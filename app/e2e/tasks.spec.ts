/**
 * Stories covered: TK-01 TK-05 TK-07 TK-08 TK-12 TK-14 TK-15 TK-16 TK-17 TK-19 TK-20 TK-22 TK-23 TK-24
 * TK-25 TK-27 TK-29 TK-30, FU-01 FU-04 FU-08, IN-01
 */
import { expect, test, type Page } from '@playwright/test';
import { NOW_MS, TODAY, ago, boot, day, db, external, task } from './helpers';
const dm = (d: string) => { const [, m, n] = d.split('-').map(Number); return `${n} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}`; };

type T = { title: string; status: string; completed_at: string | null; due_date: string | null; due_time: string | null; est_minutes: number | null; area: string; priority: number; notes: string | null };
const get = async (page: Page, title: string) => (await db<T>(page, 'os_tasks')).find((t) => t.title === title);
const quick = async (page: Page, text: string) => {
  await page.getByRole('textbox', { name: 'Quick add' }).fill(text);
};

test('TK-01 quick add parses title, date, time, minutes in one Enter', async ({ page }) => {
  await boot(page, { hash: '#/tasks', tables: { os_tasks: [] } });
  await quick(page, 'Call Sam tomorrow 3pm 20m');
  await page.getByRole('textbox', { name: 'Quick add' }).press('Enter');
  await expect.poll(() => get(page, 'Call Sam')).toBeTruthy();
  expect(await get(page, 'Call Sam')).toMatchObject({ due_date: day(1), due_time: '15:00', est_minutes: 20, area: 'work' });
});

test('TK-05 the preview shows every parsed field and saves nothing', async ({ page }) => {
  await boot(page, { hash: '#/tasks', tables: { os_tasks: [] } });
  await quick(page, 'Call Sam tomorrow 3pm 20m #sales !');
  const p = page.getByTestId('preview');
  for (const t of ['Title', 'Call Sam', 'Due', 'Time', '15:00', 'Minutes', '20', 'Project', 'sales', 'Priority', 'high', 'Area', 'work']) await expect(p).toContainText(t);
  expect(await db(page, 'os_tasks')).toHaveLength(0);
});

test('TK-07 search finds a word that only sits in waiting_on', async ({ page }) => {
  await boot(page, { hash: '#/tasks', tables: { os_tasks: [task('X', { waiting_on: 'Sam to reply' }), task('Y', { notes: 'nothing' })] } });
  await page.getByLabel('Search tasks').fill('Sam');
  await expect(page.getByTestId('task-row')).toHaveCount(1);
  await expect(page.getByTestId('task-row')).toContainText('X');
});

test('TK-08 Tasks groups with Tomorrow merged into Upcoming', async ({ page }) => {
  const ts = [-4, 0, 1, 2, 13, 14].map((n, i) => task(`G${i}`, { due_date: day(n) })).concat(task('later', { due_date: day(15) }), task('nodate'));
  await boot(page, { hash: '#/tasks', tables: { os_tasks: ts } });
  await expect(page.getByTestId('group-nodate')).toBeVisible(); // the screen loads on demand
  const order = await page.locator('[data-testid^="group-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  expect(order).toEqual(['group-overdue', 'group-today', 'group-upcoming', 'group-later', 'group-nodate']);
  await expect(page.getByTestId('group-upcoming').getByTestId('task-row')).toHaveCount(4);
});

test('TK-12 and TK-27 task row lines', async ({ page }) => {
  await boot(page, {
    hash: '#/tasks',
    tables: {
      os_tasks: [
        task('A very long title that goes past the second line for sure because it keeps going and going and going and going and going and going and going', {
          waiting_on: "Sam's yes", next_action: 'Send quote', due_date: day(-3), est_minutes: 10, project: 'sales', cost_usd: 12.5, updated_at: ago(9 * 86400_000), sort_order: 1,
        }),
        task('Only next', { next_action: 'Send quote', sort_order: 2 }),
        task('Neither', { sort_order: 3 }),
      ],
    },
  });
  const r = page.getByTestId('task-row');
  await expect(r.nth(0).locator('.t2')).toHaveText('Next: Send quote');
  // The due date of an earlier task lives in the time spine in plain ink; line 3 keeps the rest.
  await expect(r.nth(0).locator('.spine .v')).toHaveText(dm(day(-3)));
  await expect(r.nth(0).locator('.spine .sr')).toHaveText(`due ${dm(day(-3))}`);
  await expect(r.nth(0).locator('.t3')).toHaveText('10 min · sales · $12.50');
  expect(await r.nth(0).locator('.t1').evaluate((e) => getComputedStyle(e).webkitLineClamp)).toBe('2');
  await expect(r.filter({ hasText: 'Only next' }).locator('.t2')).toHaveText('Next: Send quote');
  await expect(r.filter({ hasText: 'Neither' }).locator('.t2')).toHaveCount(0);
});

test('TK-14 and TK-16 done stamps completed_at; unchecking reopens', async ({ page }) => {
  await boot(page, { hash: '#/tasks', tables: { os_tasks: [task('Finish me', { due_date: day(2) })] } });
  await page.getByRole('checkbox', { name: 'Mark Finish me done' }).click();
  await expect.poll(async () => (await get(page, 'Finish me'))?.status).toBe('done');
  const t = (await get(page, 'Finish me'))!;
  expect(Math.abs(new Date(t.completed_at!).getTime() - NOW_MS)).toBeLessThan(30_000);
  await page.getByRole('button', { name: /Done \(1\)/ }).click();
  await page.getByTestId('done-list').getByRole('checkbox').click();
  await expect.poll(async () => (await get(page, 'Finish me'))?.status).toBe('open');
  expect((await get(page, 'Finish me'))!.completed_at).toBeNull();
  await expect(page.getByTestId('group-upcoming')).toContainText('Finish me');
});

test('TK-15 Done is collapsed and limited to 30 days', async ({ page }) => {
  await boot(page, {
    hash: '#/tasks',
    tables: { os_tasks: [task('d5', { status: 'done', updated_at: ago(5 * 86400_000) }), task('d40', { status: 'done', updated_at: ago(40 * 86400_000) }), task('dr2', { status: 'dropped', updated_at: ago(2 * 86400_000) })] },
  });
  await expect(page.getByTestId('done-list')).toHaveCount(0);
  await page.getByRole('button', { name: /Done \(2\)/ }).click();
  const list = page.getByTestId('done-list');
  await expect(list.getByTestId('task-row')).toHaveCount(2);
  await expect(list).not.toContainText('d40');
});

test('TK-17 and TK-30 drop strikes through and Reopen brings it back', async ({ page }) => {
  await boot(page, { hash: '#/tasks', tables: { os_tasks: [task('Maybe', { due_date: day(2) })] } });
  await page.getByRole('button', { name: 'Open Maybe' }).click();
  await page.getByRole('button', { name: 'Drop' }).click();
  await expect.poll(async () => (await get(page, 'Maybe'))?.status).toBe('dropped');
  await page.getByRole('button', { name: /Done \(1\)/ }).click();
  const row = page.getByTestId('done-list').getByTestId('task-row');
  await expect(row).toHaveClass(/done/);
  await expect(row.getByRole('checkbox')).toHaveCount(0);
  await row.getByRole('button', { name: 'Open Maybe' }).click();
  await expect(page.getByRole('button', { name: 'Drop' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reopen' }).click();
  await expect.poll(async () => (await get(page, 'Maybe'))?.status).toBe('open');
  await expect(page.getByTestId('group-upcoming')).toContainText('Maybe');
});

test('TK-19 Delete asks first', async ({ page }) => {
  await boot(page, { hash: '#/tasks', tables: { os_tasks: [task('Doomed')] } });
  await page.getByRole('button', { name: 'Open Doomed' }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect(await db(page, 'os_tasks')).toHaveLength(1);
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect.poll(async () => (await db(page, 'os_tasks')).length).toBe(0);
});

test('TK-20 and TK-29 the sheet edits every field, shows source info, saves with a toast', async ({ page }) => {
  await boot(page, { hash: '#/tasks', tables: { os_tasks: [task('Edit me', { due_date: day(2) })] } });
  await page.getByRole('button', { name: 'Open Edit me' }).click();
  for (const l of ['Title', 'Notes', 'Due date', 'Due time', 'Planned for', 'Priority', 'Minutes it takes', 'Project', 'Needs', 'Next action', 'Cost (USD)', 'Personal or work']) await expect(page.getByLabel(new RegExp('^' + l.replace(/[()]/g, '\\$&')))).toBeEditable();
  const info = page.getByLabel('Task info');
  for (const l of ['Came from', 'Added', 'Changed']) await expect(info).toContainText(l);
  await expect(info).not.toContainText('Today');
  await page.getByLabel('Due time').fill('16:30');
  await page.getByLabel('Priority').selectOption('1');
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect(page.getByTestId('task-row')).toContainText('16:30');
  expect(await get(page, 'Edit me')).toMatchObject({ due_time: '16:30', priority: 1 });
});

test('TK-20b a bad number keeps the sheet open and loses no other edit', async ({ page }) => {
  await boot(page, { hash: '#/tasks', tables: { os_tasks: [task('Edit me', { due_date: day(2) })] } });
  await page.getByRole('button', { name: 'Open Edit me' }).click();
  await page.getByLabel('Notes').fill('keep these words');
  await page.getByLabel('Cost (USD)').fill('-5');
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('alert')).toContainText('Cost must be');
  await expect(page.getByLabel('Notes')).toHaveValue('keep these words');
  await page.getByLabel('Cost (USD)').fill('5');
  await page.getByLabel('Minutes it takes').fill('2.5');
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('alert')).toContainText('whole number');
  await page.getByLabel('Minutes it takes').fill('25');
  await page.getByRole('button', { name: 'Close' }).click();
  await expect.poll(async () => (await get(page, 'Edit me'))?.est_minutes).toBe(25);
});

test('TK-22 empty texts on Tasks and on a search with no match', async ({ page }) => {
  await boot(page, { hash: '#/tasks', tables: {} });
  await expect(page.getByText('No tasks here.')).toBeVisible();
  await page.goto('/#/plan');
  await page.getByTestId('pick-more').click();
  await expect(page.getByText('No open tasks.')).toBeVisible();
  await page.goto('/#/reminders');
  await expect(page.getByText('No reminders.')).toBeVisible();
  await page.goto('/#/habits'); // opening Habits sets Personal (call N)
  await expect(page.getByText('No habits yet.')).toBeVisible();
  await page.goto('/#/campaigns');
  await expect(page.getByText('No campaign data yet.')).toBeVisible();
});

test('TK-23 the both toggle lists work and personal together', async ({ page }) => {
  await boot(page, { hash: '#/tasks', mode: 'personal', tables: { os_tasks: [task('W', { area: 'work' }), task('P', { area: 'personal' })] } });
  await expect(page.getByTestId('task-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Both areas' }).click();
  await expect(page.getByTestId('task-row')).toHaveCount(2);
});

test('TK-24 and TK-25 quick add area follows the mode; both saves as work', async ({ page }) => {
  await boot(page, { hash: '#/tasks', mode: 'personal', tables: { os_tasks: [] } });
  await quick(page, 'Call mum');
  await page.getByRole('textbox', { name: 'Quick add' }).press('Enter');
  await expect.poll(() => get(page, 'Call mum')).toBeTruthy();
  expect((await get(page, 'Call mum'))!.area).toBe('personal');
  await page.getByRole('button', { name: 'Both areas' }).click();
  await quick(page, 'Pay vendor');
  await page.getByRole('textbox', { name: 'Quick add' }).press('Enter');
  await expect.poll(() => get(page, 'Pay vendor')).toBeTruthy();
  expect((await get(page, 'Pay vendor'))!.area).toBe('work');
});

const fu = () => task('Follow up with Fastax', { project: 'sales', source: 'master_sheet', source_ref: 'k1', due_date: day(-2), notes: 'Called twice' });

test('FU-01 each follow-up appears once, past due under Overdue', async ({ page }) => {
  await boot(page, { hash: '#/tasks', tables: { os_tasks: [fu(), task('Follow up with Apex', { project: 'sales', source: 'master_sheet', source_ref: 'k2', due_date: day(5) })] } });
  await expect(page.getByTestId('task-row').filter({ hasText: 'Fastax' })).toHaveCount(1);
  await expect(page.getByTestId('group-overdue')).toContainText('Fastax');
});

test('FU-04 and FU-08 Followed up closes the task and keeps notes', async ({ page }) => {
  await boot(page, { hash: '#/tasks', tables: { os_tasks: [fu(), task('Plain task')] } });
  // On a follow-up row the tick itself is "Followed up" (decision 8); a plain task keeps "Mark done".
  await expect(page.getByRole('checkbox', { name: 'Followed up Plain task' })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Mark Plain task done' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Mark Follow up with Fastax done' })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Followed up Follow up with Fastax' }).click();
  await expect.poll(async () => (await get(page, 'Follow up with Fastax'))?.status).toBe('done');
  const t = (await get(page, 'Follow up with Fastax'))!;
  expect(t.completed_at).toBeTruthy();
  expect(t.notes).toContain('Called twice');
  expect(t.notes).toContain(TODAY);
});

test('FU-09 a follow-up sheet says Done, and Done still logs the follow-up (R4P26)', async ({ page }) => {
  await boot(page, { hash: '#/tasks', tables: { os_tasks: [fu()] } });
  await page.getByRole('button', { name: 'Open Follow up with Fastax' }).click();
  await expect(page.getByRole('button', { name: 'Followed up', exact: true })).toHaveCount(0);
  await page.getByRole('dialog', { name: 'Task' }).getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(async () => (await db<{ notes: string | null }>(page, 'os_tasks'))[0].notes ?? '').toContain('Followed up');
});

test('IN-01 a task added from a terminal shows up within 5 minutes without reload', async ({ page }) => {
  await boot(page, { hash: '#/tasks', tables: { os_tasks: [] } });
  await expect(page.getByText('No tasks here.')).toBeVisible(); // the screen loads on demand
  await external(page, 'os_tasks', task('Reply to Sam', { source: 'claude', source_ref: 'sam-reply', due_date: day(3) }));
  await page.clock.fastForward('00:05:05');
  await expect(page.getByTestId('task-row').filter({ hasText: 'Reply to Sam' })).toBeVisible();
  await expect(page.getByTestId('task-row')).toContainText('Sun');
});

test('TK-31 the time spine shows the due date of an earlier task, and Add looks ready before any text', async ({ page }) => {
  await boot(page, { hash: '#/tasks', tables: { os_tasks: [task('Late one', { due_date: day(-57) }), task('Timed', { due_date: day(0), due_time: '15:00' }), task('Sized', { est_minutes: 20 })] } });
  await expect(page.getByTestId('task-row').filter({ hasText: 'Late one' }).locator('.spine .v')).toHaveText(dm(day(-57)));
  await expect(page.getByTestId('task-row').filter({ hasText: 'Late one' }).locator('.spine .sr')).toHaveText(`due ${dm(day(-57))}`);
  await expect(page.getByTestId('task-row').filter({ hasText: 'Timed' }).locator('.spine .v')).toHaveText('15:00');
  await expect(page.getByTestId('task-row').filter({ hasText: 'Sized' }).locator('.spine .v')).toHaveText('20m');
  const add = page.locator('form[aria-label="Quick add"]').getByRole('button', { name: 'Add', exact: true });
  await expect(add).toBeEnabled();
  await add.click();
  expect(await db(page, 'os_tasks')).toHaveLength(3);
});

test('TK-32 a quick add input is 16 px on a phone so the page does not zoom', async ({ page }) => {
  await boot(page, { hash: '#/tasks', tables: { os_tasks: [task('A')] } });
  for (const l of ['Quick add', 'Search tasks']) expect(await page.getByLabel(l, { exact: true }).last().evaluate((e) => getComputedStyle(e).fontSize)).toBe('16px');
  await page.getByRole('button', { name: 'Open A' }).click();
  expect(await page.getByLabel('Title').evaluate((e) => getComputedStyle(e).fontSize)).toBe('16px');
  expect(await page.getByLabel('Minutes it takes').evaluate((e) => getComputedStyle(e).fontSize)).toBe('16px');
});
