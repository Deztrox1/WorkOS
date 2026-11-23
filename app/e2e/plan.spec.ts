/**
 * Stories covered: PL-02 PL-04 PL-06 PL-07 PL-08 PL-09 PL-10, TK-09. Closing today and planning tomorrow live on /plan, at any
 * hour, for both areas (logs/qa-r4-plan.md decision 9). It closes today first (Done, Tomorrow, Drop on each row), then suggests
 * picks across both areas (QA r1 F06, F07). After QA round 2: what he captured today leads the suggestions, picks keep his
 * order, Move up swaps two, and the sheet ends on its own line. The morning after, the picks are the war room's plan.
 */
import { expect, test, type Page } from '@playwright/test';
import { TODAY, boot as bootAt, calEvent, claudeRow, day, db, habitRow, iso, openFold, openPlan, rowAction, task } from './helpers';

const EVENING = '2026-10-22T21:15:00+05:30';

/** Every test here starts on /plan. */
const boot = (page: Page, o: Parameters<typeof bootAt>[1] = {}) => bootAt(page, { hash: '#/plan', ...o });
const block = (page: Page) => page.getByTestId('tomorrow');
/** The war room, without a reload, so the pinned clock runs on. */
const toWarRoom = async (page: Page) => { await page.getByTestId('tab-today').click(); await expect(page.getByTestId('now-card')).toBeVisible(); };
const planned = async (page: Page, title: string) =>
  (await db<{ title: string; planned_for: string | null }>(page, 'os_tasks')).find((t) => t.title === title)?.planned_for;
const pickAll = async (page: Page) => {
  const b = page.getByTestId('pick-more');
  if ((await b.getAttribute('aria-expanded')) !== 'true') await b.click();
};

test('PL-00 the plan link opens /plan at any hour with the Tomorrow block open, and it stays there', async ({ page }) => {
  await bootAt(page, { tables: { os_tasks: [] } });
  await expect(block(page)).toHaveCount(0); // planning is not on the war room
  await page.getByTestId('plan-link').click();
  await expect(page).toHaveURL(/#\/plan$/);
  await expect(block(page)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Close today' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tomorrow, Fri 23 Oct' })).toBeVisible();
  await page.reload();
  await expect(block(page)).toBeVisible();
});

test('PL-02 review and mood upsert one day row', async ({ page }) => {
  await boot(page, { tables: { os_tasks: [] } });
  await openPlan(page);
  await page.getByLabel('How did today go').fill('Shipped the PRD');
  await page.getByLabel('How did today go').blur();
  await page.getByRole('button', { name: 'Mood 4' }).click();
  await expect.poll(async () => (await db<{ day: string; mood: number; review: string }>(page, 'os_days')).find((d) => d.day === TODAY)?.mood).toBe(4);
  const rows = (await db<{ day: string; review: string }>(page, 'os_days')).filter((d) => d.day === TODAY);
  expect(rows).toHaveLength(1);
  expect(rows[0].review).toBe('Shipped the PRD');
});

test('PL-04 Tomorrow toggles set and clear planned_for', async ({ page }) => {
  await boot(page, { tables: { os_tasks: [task('T1', { due_date: day(3) }), task('T2', { due_date: day(4) }), task('T3', { due_date: day(5) })] } });
  await openPlan(page);
  await pickAll(page);
  for (const n of ['T1', 'T2', 'T3']) await rowAction(page, n, `Tomorrow toggle for ${n}`, block(page).locator('.pick-list'));
  await expect.poll(() => planned(page, 'T3')).toBe(day(1));
  await expect(page.getByTestId('pick-footer')).toHaveText('3 picked, 0 min');
  await rowAction(page, 'T2', 'Tomorrow toggle for T2', block(page).locator('.pick-list'));
  await expect.poll(() => planned(page, 'T2')).toBeNull();
  expect(await planned(page, 'T1')).toBe(day(1));
  await expect(page.getByTestId('picked-list').getByTestId('task-row')).toHaveCount(2);
});

test('PL-04b a picked task can be unpicked from the picked list', async ({ page }) => {
  await boot(page, { tables: { os_tasks: [task('Keep', { planned_for: day(1) }), task('Drop', { planned_for: day(1) })] } });
  await openPlan(page);
  await rowAction(page, 'Drop', 'Unpick Drop', page.getByTestId('picked-list'));
  await expect.poll(() => planned(page, 'Drop')).toBeNull();
  expect(await planned(page, 'Keep')).toBe(day(1));
});

test('PL-06 the evening sheet closes today first: Drop and Tomorrow on each open row', async ({ page }) => {
  await boot(page, { clock: EVENING, tables: { os_tasks: [task('C1', { planned_for: TODAY }), task('C2', { planned_for: TODAY }), task('Due', { due_date: TODAY })] } });
  await expect(page.getByRole('heading', { name: 'Close today' })).toBeVisible();
  const close = page.getByTestId('sec-today');
  await expect(close.getByTestId('sheet-row')).toHaveCount(3);
  // close today comes before tomorrow on the page
  const y = async (sel: string) => (await page.locator(sel).first().boundingBox())!.y;
  expect(await y('[data-testid="sec-today"]')).toBeLessThan(await y('[data-testid="tomorrow"]'));
  await close.getByRole('button', { name: 'Drop C1' }).click();
  await expect.poll(async () => (await db<{ title: string; status: string }>(page, 'os_tasks')).find((t) => t.title === 'C1')?.status).toBe('dropped');
  await expect(close.getByTestId('sheet-row')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
});

test('PL-06b a row closed with Tomorrow lands in the picks', async ({ page }) => {
  await boot(page, { clock: EVENING, tables: { os_tasks: [task('C1', { planned_for: TODAY })] } });
  await page.getByTestId('sec-today').getByRole('button', { name: 'Move C1 to tomorrow' }).click();
  await expect.poll(() => planned(page, 'C1')).toBe(day(1));
  await expect(page.getByTestId('picked-list').getByTestId('task-row')).toHaveCount(1);
  await expect(page.getByText('Nothing picked for today.')).toBeVisible();
});

test('PL-06c suggestions: captured today first, then due tomorrow and overdue, across both areas with a tag, one tap each', async ({ page }) => {
  await boot(page, {
    clock: EVENING,
    tables: { os_tasks: [task('Due tomorrow', { due_date: day(1) }), task('Old personal', { area: 'personal', due_date: day(-5) }), task('Someday'), task('Picked', { due_date: day(1), planned_for: day(1) })] },
  });
  const sug = page.getByTestId('suggest-list');
  // fixtures are created at the pinned clock, so "Someday" (no date) was captured today and leads (QA r2 P04)
  await expect(sug.locator('.t1')).toHaveText(['Someday', 'Due tomorrow', 'Old personal']);
  await expect(sug.getByTestId('task-row').filter({ hasText: 'Someday' }).locator('.t3')).toContainText('captured today');
  await expect(sug.getByTestId('task-row').filter({ hasText: 'Old personal' }).locator('.t3')).toContainText('from '); // plain ink, never "late" (QA r2 C05)
  await expect(sug.getByTestId('task-row').filter({ hasText: 'Old personal' }).locator('.area-tag')).toHaveText('personal');
  await sug.getByRole('button', { name: 'Tomorrow toggle for Old personal' }).click();
  await expect.poll(() => planned(page, 'Old personal')).toBe(day(1));
  await expect(page.getByTestId('pick-footer')).toHaveText('2 picked, 0 min');
});

test('PL-06e a task Claude holds is not suggested, and only two overdue ones are', async ({ page }) => {
  const held = task('Held by Claude', { due_date: day(1) });
  await boot(page, {
    clock: EVENING,
    tables: {
      os_tasks: [held, task('Old1', { due_date: day(-30) }), task('Old2', { due_date: day(-20) }), task('Old3', { due_date: day(-10) })],
      os_claude_requests: [claudeRow('Held by Claude', { task_id: held.id })],
    },
  });
  await expect(page.getByTestId('suggest-list').locator('.t1')).toHaveText(['Old1', 'Old2']);
});

test('PL-06d the full list is searchable', async ({ page }) => {
  await boot(page, { tables: { os_tasks: [task('Alpha'), task('Beta'), task('Gamma')] } });
  await openPlan(page);
  await pickAll(page);
  await page.getByLabel('Search all tasks').fill('bet');
  await expect(block(page).locator('.pick-list').getByTestId('task-row')).toHaveCount(1);
  await rowAction(page, 'Beta', 'Tomorrow toggle for Beta', block(page).locator('.pick-list'));
  await expect.poll(() => planned(page, 'Beta')).toBe(day(1));
});

test('PL-07 picks made on Today show in TODAY after the IST rollover', async ({ page }) => {
  const tasks = [
    task('Pick1', { due_date: day(5) }), task('Pick2', { due_date: day(6) }), task('Pick3'),
    task('Over1', { due_date: day(-9) }), task('Over2', { due_date: day(-8) }),
  ];
  await boot(page, { clock: '2026-10-22T23:50:00+05:30', tables: { os_tasks: tasks } });
  // evening: the block is open; pick three tasks for tomorrow from the full list
  await expect(block(page)).toBeVisible();
  await pickAll(page);
  for (const n of ['Pick1', 'Pick2', 'Pick3']) await rowAction(page, n, `Tomorrow toggle for ${n}`, block(page).locator('.pick-list'));
  await expect(page.getByTestId('pick-footer')).toHaveText('3 picked, 0 min');
  expect(await page.getByTestId('sec-today').getByTestId('sheet-row').count()).toBe(0); // not on today's sheet yet
  await page.clock.fastForward('06:00:00'); // /plan turns the page at 05:00, not at midnight (R4Y06)
  await expect(page.getByTestId('today-date')).toHaveText('Fri 23 Oct');
  const t = await page.getByTestId('sec-today').getByTestId('sheet-row').locator('.t1').allInnerTexts();
  expect(t.slice().sort()).toEqual(['Pick1', 'Pick2', 'Pick3']);
  await expect(page.getByTestId('sec-today').getByTestId('sheet-row').first().locator('.t3')).not.toContainText('late');
  // the next morning the picks are the plan; the backlog he did not pick folds into one line under them
  await page.clock.fastForward('01:00:00');
  await toWarRoom(page);
  await expect(page.getByTestId('now-title')).toHaveText('Pick1');
  await expect(page.getByTestId('plan-list').locator('[data-kind="task"] .t1')).toHaveText(['Pick2', 'Pick3']);
  await expect(page.getByTestId('fold-older')).toContainText('2 older tasks');
  await openFold(page, 'older');
  expect(await page.getByTestId('sec-older').getByTestId('plan-row').locator('.t1').allInnerTexts()).toEqual(['Over1', 'Over2']);
});

test('PL-07b tasks planned for tomorrow before midnight are already in TODAY after the rollover', async ({ page }) => {
  const tasks = [task('Pick1', { planned_for: day(1), due_date: day(5) }), task('Pick2', { planned_for: day(1) }), task('Over1', { due_date: day(-9) })];
  await boot(page, { clock: '2026-10-22T23:50:00+05:30', tables: { os_tasks: tasks } });
  expect(await page.getByTestId('sec-today').getByTestId('sheet-row').count()).toBe(0);
  await page.clock.fastForward('06:00:00');
  await expect(page.getByTestId('today-date')).toHaveText('Fri 23 Oct');
  expect((await page.getByTestId('sec-today').getByTestId('sheet-row').locator('.t1').allInnerTexts()).sort()).toEqual(['Pick1', 'Pick2']);
});

test('PL-08 tomorrow plan saves to tomorrow and survives reload', async ({ page }) => {
  await boot(page, { tables: { os_tasks: [] } });
  await openPlan(page);
  await page.getByLabel('What is tomorrow about').fill('Pitch deck');
  await page.getByLabel('What is tomorrow about').blur();
  await expect.poll(async () => (await db<{ day: string; plan: string }>(page, 'os_days')).find((d) => d.day === day(1))?.plan).toBe('Pitch deck');
  await page.reload();
  await openPlan(page);
  await expect(page.getByLabel('What is tomorrow about')).toHaveValue('Pitch deck');
});

test('PL-09 unsaved text saves to the day it was typed for when the page turns at 05:00', async ({ page }) => {
  await boot(page, { clock: '2026-10-22T23:55:00+05:30', tables: { os_tasks: [] } });
  await openPlan(page);
  await page.getByLabel('What is tomorrow about').fill('Call bank');
  await page.clock.fastForward('06:00:00');
  await expect.poll(async () => (await db<{ day: string; plan: string }>(page, 'os_days')).find((d) => d.day === day(1))?.plan).toBe('Call bank');
  await expect(page.getByTestId('today-date')).toHaveText('Fri 23 Oct');
  // after 05:00 the block is for the new tomorrow
  await openPlan(page);
  await expect(page.getByRole('heading', { name: /^Tomorrow, / })).toContainText('Sat 24 Oct');
  await expect(page.getByLabel('What is tomorrow about')).toHaveValue('');
});

test('PL-10 the picked count and minutes show above the picks', async ({ page }) => {
  await boot(page, { tables: { os_tasks: [task('a', { planned_for: day(1), est_minutes: 20 }), task('b', { planned_for: day(1) }), task('c', { planned_for: day(1), est_minutes: 10 })] } });
  await openPlan(page);
  await expect(page.getByTestId('pick-footer')).toHaveText('3 picked, 30 min');
  await expect(page.getByTestId('picked-list').getByTestId('task-row')).toHaveCount(3);
});

test('TK-09 the full list shows Tomorrow as its own group', async ({ page }) => {
  const dues = [-4, 0, 1, 2, 13, 14, 15].map((n, i) => task(`P${i}`, { due_date: day(n) })).concat(task('nodate'));
  await boot(page, { tables: { os_tasks: dues } });
  await openPlan(page);
  await pickAll(page);
  for (const k of ['overdue', 'today', 'tomorrow', 'next14', 'later', 'nodate']) await expect(block(page).getByTestId(`group-${k}`)).toBeVisible();
  await expect(block(page).getByTestId('group-next14').getByTestId('task-row')).toHaveCount(3);
  await expect(block(page).getByTestId('group-later').getByTestId('task-row')).toHaveCount(1);
  await expect(block(page).getByTestId('group-tomorrow').getByTestId('task-row').filter({ hasText: 'P2' })).toHaveCount(1);
});

test('PL-02b clicking the selected mood unsets it; clearing the review writes null', async ({ page }) => {
  await boot(page, { tables: { os_tasks: [] } });
  await openPlan(page);
  await page.getByLabel('How did today go').fill('x');
  await page.getByLabel('How did today go').blur();
  await page.getByRole('button', { name: 'Mood 4' }).click();
  await expect.poll(async () => (await db<{ day: string; mood: number | null }>(page, 'os_days')).find((d) => d.day === TODAY)?.mood).toBe(4);
  await expect(page.getByRole('button', { name: 'Mood 4' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Mood 4' }).click();
  await expect.poll(async () => (await db<{ day: string; mood: number | null }>(page, 'os_days')).find((d) => d.day === TODAY)?.mood).toBeNull();
  await page.getByLabel('How did today go').fill('');
  await page.getByLabel('How did today go').blur();
  await expect.poll(async () => (await db<{ day: string; review: string | null }>(page, 'os_days')).find((d) => d.day === TODAY)?.review).toBeNull();
});

test('PL-12 picks keep his order into the morning, and the first pick is Now', async ({ page }) => {
  await boot(page, { clock: '2026-10-22T23:50:00+05:30', tables: { os_tasks: [task('Alpha', { due_date: day(5) }), task('Zed', { due_date: day(9) })] } });
  await pickAll(page);
  await rowAction(page, 'Zed', 'Tomorrow toggle for Zed', block(page).locator('.pick-list'));
  await expect.poll(() => planned(page, 'Zed')).toBe(day(1));
  await rowAction(page, 'Alpha', 'Tomorrow toggle for Alpha', block(page).locator('.pick-list'));
  await expect.poll(() => planned(page, 'Alpha')).toBe(day(1));
  await expect.poll(async () => (await db<{ day: string; top_task_ids: string[] }>(page, 'os_days')).find((d) => d.day === day(1))?.top_task_ids?.length).toBe(2);
  await expect(page.getByTestId('picked-list').locator('.t1')).toHaveText(['Zed', 'Alpha']);
  await page.clock.fastForward('06:00:00');
  await expect(page.getByTestId('today-date')).toHaveText('Fri 23 Oct');
  expect(await page.getByTestId('sec-today').getByTestId('sheet-row').locator('.t1').allInnerTexts()).toEqual(['Zed', 'Alpha']);
  await page.clock.fastForward('01:00:00');
  await toWarRoom(page);
  await expect(page.getByTestId('now-title')).toHaveText('Zed');
});

test('PL-13 Move up swaps two picks, and the sheet ends on the first pick', async ({ page }) => {
  await boot(page, { clock: EVENING, tables: { os_tasks: [task('One', { planned_for: day(1), sort_order: 1 }), task('Two', { planned_for: day(1), sort_order: 2 })] } });
  const picked = page.getByTestId('picked-list');
  await expect(picked.locator('.t1')).toHaveText(['One', 'Two']);
  await expect(page.getByTestId('closing-line')).toHaveText('Tomorrow is set. It starts with One.');
  await rowAction(page, 'Two', 'Move Two up', picked);
  await expect(picked.locator('.t1')).toHaveText(['Two', 'One']);
  await expect(page.getByTestId('closing-line')).toHaveText('Tomorrow is set. It starts with Two.');
});

test('PL-14 the evening says what is done, and ends on its own line', async ({ page }) => {
  await boot(page, { clock: EVENING, tables: { os_tasks: [task('Open one', { planned_for: TODAY }), task('Done one', { planned_for: TODAY, status: 'done', completed_at: new Date(EVENING).toISOString() })] } });
  await expect(page.getByTestId('greeting')).toHaveText('Close today: 1 done, 1 still open. Then pick tomorrow.');
  await expect(page.getByTestId('sec-today').getByRole('checkbox', { name: 'Reopen Done one' })).toBeVisible();
  await expect(page.getByTestId('closing-line')).toHaveText('Nothing picked. Tomorrow starts with the oldest tasks.');
});

test('PL-15 Tomorrow keeps the time of a timed task due today', async ({ page }) => {
  await boot(page, { clock: EVENING, tables: { os_tasks: [task('Proposal', { planned_for: TODAY, due_date: TODAY, due_time: '12:00:00' })] } });
  await page.getByTestId('sec-today').getByRole('button', { name: 'Move Proposal to tomorrow' }).click();
  await expect.poll(async () => (await db<{ title: string; planned_for: string; due_date: string; due_time: string }>(page, 'os_tasks')).find((t) => t.title === 'Proposal')).toMatchObject({ planned_for: day(1), due_date: day(1), due_time: '12:00:00' });
});

test('PL-16 habits are one quiet line in the evening, not a to-do list', async ({ page }) => {
  await boot(page, { clock: EVENING, mode: 'personal', tables: { os_habits: [habitRow('Gym', { time_local: '14:15' }), habitRow('Flute', { time_local: '19:00' })], os_tasks: [] } });
  await expect(page.getByTestId('habits-left')).toContainText('2 habits to tick');
  await expect(page.getByTestId('habit-row')).toHaveCount(0);
  await page.getByTestId('habits-left').click();
  await expect(page.getByTestId('habit-row')).toHaveCount(2);
});

test('PL-17 a pick at 00:30 lands on the coming morning, and the day just ended stays the one being closed (R4Y06)', async ({ page }) => {
  await boot(page, { clock: '2026-10-23T00:30:00+05:30', tables: { os_tasks: [task('Northwind', { due_date: day(-5) }), task('Left from Thursday', { planned_for: TODAY })] } });
  await expect(page.getByTestId('today-date')).toHaveText('Thu 22 Oct');
  await expect(page.getByRole('heading', { name: /^Tomorrow, / })).toHaveText('Tomorrow, Fri 23 Oct. 0 picked');
  await expect(page.getByTestId('sec-today').locator('.t1')).toHaveText(['Left from Thursday']);
  await page.getByTestId('suggest-list').getByRole('button', { name: 'Tomorrow toggle for Northwind' }).click();
  await expect.poll(() => planned(page, 'Northwind')).toBe(day(1));
  await expect.poll(async () => (await db<{ day: string; top_task_ids: string[] }>(page, 'os_days')).find((d) => d.day === day(1))?.top_task_ids?.length).toBe(1);
  await expect(page.getByRole('heading', { name: /^Tomorrow, / })).toHaveText('Tomorrow, Fri 23 Oct. 1 picked');
  await expect(page.getByTestId('greeting')).toHaveText('Close today: 1 still open. Tomorrow is set. It starts with Northwind.');
  await expect(page.getByTestId('sec-today').locator('.t1')).toHaveText(['Left from Thursday']); // a pick never lands in the day being closed
  // the review and the mood belong to the day that ended
  await page.getByLabel('How did today go').fill('Late one');
  await page.getByLabel('How did today go').blur();
  await page.getByRole('button', { name: 'Mood 4' }).click();
  await expect.poll(async () => (await db<{ day: string; review: string; mood: number }>(page, 'os_days')).find((d) => d.day === TODAY)).toMatchObject({ review: 'Late one', mood: 4 });
  // the war room, on the new date, opens the night on that same pick
  await toWarRoom(page);
  await expect(page.getByTestId('now-line')).toHaveText('Tomorrow is set. It starts with Northwind.');
});

test('PL-17b leftovers moved on at 00:30 go to the coming morning too (R4Y06)', async ({ page }) => {
  await boot(page, { clock: '2026-10-23T00:30:00+05:30', tables: { os_tasks: [task('Left', { planned_for: TODAY })] } });
  await page.getByTestId('sec-today').getByRole('button', { name: 'Move Left to tomorrow' }).click();
  await expect.poll(() => planned(page, 'Left')).toBe(day(1));
});

test('PL-18 at 18:30 the head does not call the day closed, and only habits that have had their time are counted (R4Y07)', async ({ page }) => {
  await boot(page, {
    clock: '2026-10-22T18:30:00+05:30',
    tables: { os_tasks: [task('Undated')], os_habits: [habitRow('Gym', { time_local: '14:15' }), habitRow('Flute', { time_local: '19:00' }), habitRow('Read')] },
  });
  await expect(page.getByTestId('greeting')).toHaveText('Pick tomorrow.');
  await expect(page.getByTestId('today-empty')).toHaveText('Nothing picked for today.');
  await expect(page.getByTestId('habits-left')).toContainText('2 habits to tick');
  await page.getByTestId('habits-left').click();
  await expect(page.getByTestId('habit-row').locator('.t1')).toHaveText(['Gym', 'Read']);
});

test('PL-18b with something done the head counts it, and one habit reads as one (R4Y07)', async ({ page }) => {
  await boot(page, {
    clock: '2026-10-22T18:30:00+05:30',
    tables: { os_tasks: [task('Done one', { planned_for: TODAY, status: 'done', completed_at: new Date('2026-10-22T10:00:00+05:30').toISOString() })], os_habits: [habitRow('Gym', { time_local: '14:15' })] },
  });
  await expect(page.getByTestId('greeting')).toHaveText('1 done today. Pick tomorrow.');
  await expect(page.getByTestId('habits-left')).toContainText('1 habit to tick');
});

test('PL-19 the picks sit above the suggestions, at most 5 are offered, and the heading says how many are picked (R4Y12)', async ({ page }) => {
  const pick = task('Mine', { planned_for: day(1) });
  await boot(page, {
    tables: {
      os_tasks: [pick, ...['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((x) => task(x))],
      os_days: [{ day: day(1), plan: null, review: null, top_task_ids: [pick.id as string], mood: null }],
    },
  });
  await expect(page.getByRole('heading', { name: /^Tomorrow, / })).toHaveText('Tomorrow, Fri 23 Oct. 1 picked');
  await expect(page.getByTestId('suggest-list').getByTestId('task-row')).toHaveCount(5);
  const y = async (id: string) => (await page.getByTestId(id).boundingBox())!.y;
  expect(await y('picked-list')).toBeLessThan(await y('suggest-list'));
  await page.getByTestId('suggest-list').getByRole('button').first().click();
  await expect(page.getByRole('heading', { name: /^Tomorrow, / })).toHaveText('Tomorrow, Fri 23 Oct. 2 picked');
});

test('PL-19b with nothing picked the empty line points down at the suggestions (R4Y12)', async ({ page }) => {
  await boot(page, { tables: { os_tasks: [task('A')] } });
  await expect(block(page).getByText('Nothing picked yet. Tap a task below or in the full list.')).toBeVisible();
});

test('PL-20 a timed event that began days ago is still on tomorrow, marked all day, not by its old time (R4X11)', async ({ page }) => {
  await boot(page, { tables: { os_calendar_events: [calEvent('Conference', '09:00', '18:00', { starts_at: iso(day(-2), '09:00'), ends_at: iso(day(2), '18:00') })] } });
  await expect(page.getByTestId('tomorrow-calendar').locator('li')).toHaveText(['all dayConference']);
});
