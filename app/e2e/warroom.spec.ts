/**
 * The war room on a phone (logs/qa-r4-plan.md decisions 9 to 11): one screen for both areas, Now and Next on top, the rest in
 * order, Google Calendar's fixed blocks in the same order, everything else behind one line. The order comes from the current
 * minute, so nothing is ever late. Evening close and tomorrow live on /plan.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  NOW_MS, TODAY, allDayEvent, ago, boot, calEvent, calState, claudeRow, day, db, event, habitRow, iso, openFold, reminderRow, rowAction, rowHas, settings, snapRow, spyOpen, task, windowOpens,
} from './helpers';

const nowTitle = (page: Page) => page.getByTestId('now-title');
const nowLine = (page: Page) => page.getByTestId('now-line');
const listRows = (page: Page) => page.getByTestId('plan-list').getByTestId('plan-row');
const listTitles = (page: Page) => listRows(page).locator('.t1').allInnerTexts();
const order = async (page: Page) => (await db<{ day: string; top_task_ids: string[] }>(page, 'os_days')).find((d) => d.day === TODAY)?.top_task_ids;
/** A real pick for tomorrow: on its day and in that day's saved order. A task only pushed there is not one (R4Y05). */
const pitched = (tasks: ReturnType<typeof task>[]) => {
  const pitch = task('Pitch', { planned_for: day(1) });
  return { os_tasks: [...tasks, pitch], os_days: [{ day: day(1), plan: null, review: null, top_task_ids: [pitch.id as string], mood: null }] };
};
const three = () => [
  task('Alpha', { planned_for: TODAY, sort_order: 1 }),
  task('Bravo', { planned_for: TODAY, sort_order: 2 }),
  task('Charlie', { planned_for: TODAY, sort_order: 3 }),
];

test('WR-01 Now shows his first pick, in his order, and Next is the one after it', async ({ page }) => {
  const [a, b, c] = three();
  await boot(page, {
    tables: {
      os_tasks: [a, b, c],
      os_days: [{ day: TODAY, plan: null, review: null, top_task_ids: [c.id as string, a.id as string, b.id as string], mood: null }],
      os_reminders: [reminderRow('Morning look', { repeat: 'daily', time_local: '09:10' })],
    },
  });
  await expect(page.getByTestId('now-card')).toHaveAttribute('data-kind', 'task');
  await expect(nowTitle(page)).toHaveText('Charlie'); // never the reminder
  // one list by time: the 09:10 reminder sits above Next, and the word stays on what is really next (call J)
  await expect(listRows(page).first()).toHaveAttribute('data-kind', 'reminder');
  await expect(listRows(page).filter({ hasText: 'Alpha' }).locator('.wl-word')).toHaveText('Next');
  await expect(page.locator('.wl-word')).toHaveCount(1);
  await expect(page.getByTestId('greeting')).toHaveText('Good morning. 3 to do.');
});

test('WR-02 a calendar event running now is Now, with its Until line; the task waits as Next', async ({ page }) => {
  await boot(page, { tables: { os_tasks: three(), os_calendar_events: [calEvent('Standup', '08:30', '09:30')] } });
  await expect(page.getByTestId('now-card')).toHaveAttribute('data-kind', 'event');
  await expect(nowTitle(page)).toHaveText('Standup');
  await expect(nowLine(page)).toHaveText('Until 09:30.');
  await expect(page.getByTestId('now-done')).toHaveCount(0); // an event is not ticked off
  await expect(page.getByTestId('now-later')).toHaveCount(0);
  await expect(listRows(page).first()).toContainText('Alpha');
  // the task after a block starts when the block ends
  await expect(listRows(page).first().locator('.wl-time')).toContainText('09:30');
});

test('WR-02b the plan moves on by itself when an event ends', async ({ page }) => {
  await boot(page, { tables: { os_tasks: three(), os_calendar_events: [calEvent('Standup', '08:30', '09:30')] } });
  await expect(nowTitle(page)).toHaveText('Standup');
  await page.clock.fastForward('00:31:00');
  await expect(nowTitle(page)).toHaveText('Alpha');
  await expect(page.getByText('Standup')).toHaveCount(0);
});

test('WR-03 Done moves Next up to Now, keeps a Done fold, and the tick there reopens it', async ({ page }) => {
  await boot(page, { tables: { os_tasks: three() } });
  await expect(nowTitle(page)).toHaveText('Alpha');
  await page.getByTestId('now-done').click();
  await expect(nowTitle(page)).toHaveText('Bravo');
  await expect.poll(async () => (await db<{ title: string; status: string }>(page, 'os_tasks')).find((t) => t.title === 'Alpha')?.status).toBe('done');
  await expect(listRows(page).first().locator('.wl-word')).toHaveText('Next');
  await expect(listRows(page).first()).toContainText('Charlie');
  await expect(page.getByTestId('greeting')).toHaveText('Good morning. 2 to do, 1 done.');
  await expect(page.getByTestId('fold-done')).toContainText('1 done today');
  await openFold(page, 'done');
  await page.getByTestId('sec-done').getByRole('checkbox', { name: 'Reopen Alpha' }).click();
  await expect(nowTitle(page)).toHaveText('Alpha');
  await expect(page.getByTestId('fold-done')).toHaveCount(0);
});

test('WR-03b the tick on a plan row finishes it where it stands, and everything done says so', async ({ page }) => {
  await boot(page, { tables: { os_tasks: three().slice(0, 2) } });
  await page.getByRole('checkbox', { name: 'Mark Bravo done' }).click();
  await expect(page.getByTestId('plan-list')).toHaveCount(0);
  await expect(nowTitle(page)).toHaveText('Alpha');
  await page.getByTestId('now-done').click();
  await expect(page.getByTestId('now-card')).toHaveAttribute('data-kind', 'none');
  await expect(nowTitle(page)).toHaveText('All done.');
  await expect(page.getByTestId('greeting')).toHaveText('Good morning. That is everything for today, 2 done.');
});

test('WR-03c on a follow-up the big button says Done and still logs the day (R4P26)', async ({ page }) => {
  await boot(page, { tables: { os_tasks: [task('Follow up with Sam', { project: 'sales', source: 'master_sheet', source_ref: 'k1', due_date: day(-1), planned_for: TODAY })] } });
  await expect(page.getByTestId('now-done')).toHaveText('Done');
  await page.getByTestId('now-done').click();
  await expect(page.getByText('Done: Follow up with Sam')).toBeVisible(); // an invoice is not "followed up" (R4Y14)
  const t = (await db<{ status: string; notes: string }>(page, 'os_tasks'))[0];
  expect(t.status).toBe('done');
  expect(t.notes).toContain(`Followed up ${TODAY}`);
});

test('WR-04 Not now sends it to the end, and Undo puts it back', async ({ page }) => {
  const [a, b, c] = three();
  await boot(page, { tables: { os_tasks: [a, b, c] } });
  await expect(nowTitle(page)).toHaveText('Alpha');
  await expect(page.getByTestId('now-later')).toHaveText('Not now'); // a pick only moves, so it is not "Not today" (R4Y16)
  await page.getByTestId('now-later').click();
  await expect(nowTitle(page)).toHaveText('Bravo');
  await expect.poll(() => listTitles(page)).toEqual(['Charlie', 'Alpha']);
  await expect.poll(() => order(page)).toEqual([b.id, c.id, a.id]);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(nowTitle(page)).toHaveText('Alpha');
  await expect.poll(() => listTitles(page)).toEqual(['Bravo', 'Charlie']);
  await expect.poll(() => order(page)).toEqual([]);
});

test('WR-04b Not now is not offered when there is nothing else to do', async ({ page }) => {
  await boot(page, { tables: { os_tasks: three().slice(0, 1) } });
  await expect(nowTitle(page)).toHaveText('Alpha');
  await expect(page.getByTestId('now-done')).toBeVisible();
  await expect(page.getByTestId('now-later')).toHaveCount(0);
});

test('WR-05 Do first moves a row to Now and saves the order', async ({ page }) => {
  const [a, b, c] = three();
  await boot(page, { tables: { os_tasks: [a, b, c] } });
  await expect(nowTitle(page)).toHaveText('Alpha');
  await rowAction(page, 'Charlie', 'Do Charlie first');
  await expect(nowTitle(page)).toHaveText('Charlie');
  await expect(page.getByText('Moved to the top: Charlie')).toBeVisible(); // the same toast and Undo as every other move (R4Y15)
  await expect.poll(() => order(page)).toEqual([c.id, a.id, b.id]);
  await page.reload();
  await expect(nowTitle(page)).toHaveText('Charlie');
});

test('WR-05b the row menu moves a task to tomorrow, and it leaves the day', async ({ page }) => {
  await boot(page, { tables: { os_tasks: three() } });
  await rowAction(page, 'Bravo', 'Move Bravo to tomorrow');
  await expect.poll(async () => (await db<{ title: string; planned_for: string }>(page, 'os_tasks')).find((t) => t.title === 'Bravo')?.planned_for).toBe(day(1));
  await expect.poll(() => listTitles(page)).toEqual(['Charlie']);
});

test('WR-06 a timed task stays at its time: no tilde, no Do first, and the others move around it', async ({ page }) => {
  await boot(page, {
    tables: {
      os_tasks: [
        task('Flex one', { planned_for: TODAY, sort_order: 1, est_minutes: 30 }),
        task('Flex two', { planned_for: TODAY, sort_order: 2, est_minutes: 30 }),
        task('Timed', { planned_for: TODAY, due_date: TODAY, due_time: '11:00:00' }),
      ],
    },
  });
  await expect(nowTitle(page)).toHaveText('Flex one');
  await expect(nowLine(page)).toHaveText('2 h free, then Timed at 11:00.');
  const timed = listRows(page).filter({ hasText: 'Timed' }).locator('.wl-time');
  await expect(timed).toHaveText('11:00');
  await expect(timed).not.toHaveClass(/est/);
  const flex = listRows(page).filter({ hasText: 'Flex two' }).locator('.wl-time');
  await expect(flex).toHaveClass(/est/); // an estimate is marked as one
  await expect(flex).toContainText('09:30');
  await expect.poll(() => rowHas(page, 'Flex two', 'Do Flex two first')).toBe(true);
  expect(await rowHas(page, 'Timed', 'Do Timed first')).toBe(false);
  await page.getByTestId('now-later').click();
  await expect(nowTitle(page)).toHaveText('Flex two');
  await expect(timed).toHaveText('11:00');
  await expect.poll(() => listTitles(page)).toEqual(['Flex one', 'Timed']);
});

test('WR-06b a task holds Now until a timed task is within 5 minutes; then the timed one is Now and cannot be pushed away', async ({ page, browser }) => {
  const tables = () => ({
    os_tasks: [
      task('Long one', { planned_for: TODAY, est_minutes: 30 }),
      task('Soon', { planned_for: TODAY, due_date: TODAY, due_time: '09:10:00', est_minutes: 15 }),
    ],
  });
  await boot(page, { tables: tables() });
  await expect(nowTitle(page)).toHaveText('Long one');
  await expect(nowLine(page)).toHaveText('10 min free, then Soon at 09:10.');
  const near = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await boot(near, { clock: '2026-10-22T09:06:00+05:30', tables: tables() });
  await expect(nowTitle(near)).toHaveText('Soon');
  await expect(nowLine(near)).toHaveText('Starts at 09:10, in 4 min.');
  await expect(near.getByTestId('now-later')).toHaveCount(0);
  await expect(near.getByTestId('now-done')).toBeVisible();
  await near.close();
});

test('WR-06c a task whose time has passed goes first, with no word about it, and is not fixed any more', async ({ page }) => {
  await boot(page, {
    clock: '2026-10-22T13:00:00+05:30',
    tables: { os_tasks: [task('Write proposal', { planned_for: TODAY }), task('Client call', { planned_for: TODAY, due_date: TODAY, due_time: '11:00:00' })] },
  });
  await expect(nowTitle(page)).toHaveText('Client call');
  await expect(nowLine(page)).toHaveText('Nothing fixed after this today.');
  await expect(page.getByTestId('now-later')).toBeVisible();
  await expect(page.getByTestId('now-card')).not.toContainText('11:00');
});

test('WR-07 both areas are on one plan with their tags, whichever mode was last used, and there is no mode switch', async ({ page }) => {
  await boot(page, {
    mode: 'personal',
    tables: {
      os_tasks: [task('Work thing', { planned_for: TODAY, sort_order: 1 }), task('Call mum', { area: 'personal', planned_for: TODAY, sort_order: 2 }), task('Invoice', { planned_for: TODAY, sort_order: 3 })],
      os_habits: [habitRow('Read')],
    },
  });
  await expect(nowTitle(page)).toHaveText('Work thing');
  await expect(page.getByTestId('now-card').locator('.area-tag')).toHaveText('work');
  const mum = listRows(page).filter({ hasText: 'Call mum' });
  await expect(mum.locator('.area-tag')).toHaveText('personal');
  await expect(mum.locator('.area-tag')).toHaveClass(/personal/);
  await expect(listRows(page).filter({ hasText: 'Invoice' }).locator('.area-tag')).toHaveText('work');
  await expect(listRows(page).filter({ hasText: 'Read' })).toHaveAttribute('data-kind', 'habit');
  await expect(page.getByRole('group', { name: 'Mode' })).toHaveCount(0);
  await expect(page.getByRole('radiogroup', { name: 'Mode' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Work', exact: true })).toHaveCount(0);
  await page.goto('/?mock=1#/plan');
  await expect(page.getByRole('heading', { name: 'Close today' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Work', exact: true })).toHaveCount(0);
  await page.goto('/?mock=1#/tasks');
  await expect(page.getByRole('button', { name: 'Work', exact: true })).toBeVisible();
});

test('WR-08 a habit and a calendar block with the same name show once: the habit keeps its tick and takes the block time', async ({ page }) => {
  await boot(page, {
    tables: {
      os_tasks: [task('Alpha', { planned_for: TODAY })],
      os_habits: [habitRow('Gym', { time_local: '14:15' })],
      os_calendar_events: [calEvent(' gym ', '17:00', '18:00')],
    },
  });
  await expect(nowTitle(page)).toHaveText('Alpha');
  const gym = page.getByTestId('plan-row').filter({ hasText: /gym/i });
  await expect(gym).toHaveCount(1);
  await expect(gym).toHaveAttribute('data-kind', 'habit');
  await expect(gym.locator('.wl-t')).toHaveText('17:00');
  await gym.getByRole('checkbox', { name: 'Gym done today' }).click();
  await expect.poll(async () => (await db(page, 'os_habit_logs')).length).toBe(1);
  await expect(page.getByTestId('plan-row').filter({ hasText: /gym/i })).toHaveCount(0); // done means the block goes too
});

test('WR-09 the calendar copy of a task shows once, as the task', async ({ page }) => {
  const t = task('Call Sam', { due_date: TODAY, due_time: '11:00:00', planned_for: TODAY });
  await boot(page, {
    tables: {
      os_tasks: [task('Alpha', { planned_for: TODAY }), t],
      os_calendar_events: [calEvent('Call Sam', '11:00', '11:30', { task_id: t.id })],
    },
  });
  await expect(nowTitle(page)).toHaveText('Alpha');
  const row = page.getByTestId('plan-row').filter({ hasText: 'Call Sam' });
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-kind', 'task');
});

test('WR-09b the copy of a task running right now never takes Now away from the task list', async ({ page }) => {
  const t = task('Ship it', { planned_for: TODAY });
  await boot(page, { tables: { os_tasks: [t], os_calendar_events: [calEvent('Ship it', '08:30', '09:30', { task_id: t.id })] } });
  await expect(page.getByTestId('now-card')).toHaveAttribute('data-kind', 'task');
  await expect(page.getByTestId('now-done')).toBeVisible();
});

test('WR-10 a Free event is never Now: it sits in the list at its time and takes none', async ({ page }) => {
  await boot(page, { tables: { os_calendar_events: [calEvent('Maybe coffee', '08:30', '09:45', { busy: false }), calEvent('Free block', '10:00', '11:00', { busy: false })] } });
  await expect(page.getByTestId('now-card')).toHaveAttribute('data-kind', 'none');
  await expect(page.getByTestId('now-card')).not.toContainText('Free block');
  await expect(page.getByTestId('now-card')).not.toContainText('Maybe coffee');
  await expect(page.getByTestId('greeting')).toHaveText('Good morning. Nothing on today.');
  const free = listRows(page).filter({ hasText: 'Free block' });
  await expect(free).toHaveAttribute('data-kind', 'event');
  await expect(free).toHaveClass(/quiet/);
  await expect(free.locator('.wl-time')).toHaveText('10:00');
});

test('WR-10b a task is Now through a Free event, and its time is not moved by it', async ({ page }) => {
  await boot(page, { tables: { os_tasks: three().slice(0, 2), os_calendar_events: [calEvent('Free block', '09:05', '11:00', { busy: false })] } });
  await expect(nowTitle(page)).toHaveText('Alpha');
  await expect(nowLine(page)).toHaveText('Nothing fixed after this today.');
  await expect(listRows(page).filter({ hasText: 'Bravo' }).locator('.wl-time')).toContainText('09:30');
});

test('WR-11 all-day events are one quiet line; so is a long backdrop block, which never holds Now', async ({ page }) => {
  await boot(page, {
    tables: {
      os_tasks: three().slice(0, 1),
      os_calendar_events: [
        allDayEvent('Diwali'),
        allDayEvent('Trip to Pune', day(-1), day(2)),
        allDayEvent('Ended yesterday', day(-2), TODAY),
        allDayEvent('Starts tomorrow', day(1), day(2)),
        calEvent('Office day', '08:00', '18:00'),
      ],
    },
  });
  const line = page.getByTestId('all-day');
  await expect(line).toContainText('Diwali');
  await expect(line).toContainText('Trip to Pune');
  await expect(line).toContainText('Office day');
  await expect(line).not.toContainText('Ended yesterday');
  await expect(line).not.toContainText('Starts tomorrow');
  await expect(nowTitle(page)).toHaveText('Alpha');
});

test('WR-11b no all-day events, no line', async ({ page }) => {
  await boot(page, { tables: { os_tasks: three().slice(0, 1) } });
  await expect(nowTitle(page)).toHaveText('Alpha');
  await expect(page.getByTestId('all-day')).toHaveCount(0);
});

const MEET = 'https://meet.google.com/abc-defg-hij';
const MEET2 = 'https://meet.google.com/xyz-abcd-efg';
const CAL = 'https://www.google.com/calendar/event?eid=abc';

test('WR-12 Join and Open in Calendar open their safe links, on Now and on a later row', async ({ page }) => {
  await spyOpen(page);
  await boot(page, {
    tables: {
      os_calendar_events: [
        calEvent('Client call', '08:45', '09:30', { meet_link: MEET, html_link: CAL }),
        calEvent('Board call', '15:00', '15:30', { meet_link: MEET2, html_link: `${CAL}-2` }),
        calEvent('Later block', '16:00', '16:30', { html_link: `${CAL}-3` }),
      ],
    },
  });
  await expect(nowTitle(page)).toHaveText('Client call');
  await page.getByRole('button', { name: 'Join Client call' }).click();
  await page.getByRole('button', { name: 'Open in Calendar' }).click();
  expect(await windowOpens(page)).toEqual([MEET, CAL]);
  await page.getByRole('button', { name: 'Join Board call' }).click();
  await page.getByRole('button', { name: 'Open Board call in Google Calendar' }).click();
  await page.getByRole('button', { name: 'Open Later block in Google Calendar' }).click();
  expect((await windowOpens(page)).slice(2)).toEqual([MEET2, `${CAL}-2`, `${CAL}-3`]);
  await expect(page.getByRole('button', { name: 'Join Later block' })).toHaveCount(0);
});

for (const [name, link] of [
  ['a javascript link', 'javascript:window.__xss=1'],
  ['another host', 'https://evil.example/calendar/x'],
  ['a host that only looks like Google', 'https://www.google.com.evil.example/calendar/x'],
  ['plain http', 'http://meet.google.com/abc'],
  ['a tool the app opens elsewhere', 'https://github.com/x'],
  ['a link with a login in it', 'https://user:pw@meet.google.com/abc'],
  ['Google, but not the calendar', 'https://www.google.com/search?q=x'],
] as const) {
  test(`WR-13 ${name} in meet_link or html_link does nothing`, async ({ page }) => {
    await spyOpen(page);
    await boot(page, {
      tables: {
        os_calendar_events: [
          calEvent('Bad now', '08:45', '09:30', { meet_link: link, html_link: link }),
          calEvent('Bad row', '15:00', '15:30', { meet_link: link, html_link: link }),
        ],
      },
    });
    await expect(nowTitle(page)).toHaveText('Bad now');
    await expect(page.getByRole('button', { name: /^Join / })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open in Calendar' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /in Google Calendar$/ })).toHaveCount(0);
    await listRows(page).filter({ hasText: 'Bad row' }).locator('.t1').click();
    await nowTitle(page).click();
    expect(await windowOpens(page)).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  });
}

test('WR-14 a title with markup shows as plain text, on every kind of row', async ({ page }) => {
  const bad = '<img src=x onerror="window.__xss=1">';
  await boot(page, {
    tables: {
      os_tasks: [task(`${bad} task`, { planned_for: TODAY })],
      os_calendar_events: [calEvent(`${bad} now`, '08:30', '09:30'), calEvent(`${bad} later`, '15:00', '15:30'), allDayEvent(`${bad} all day`)],
    },
  });
  await expect(nowTitle(page)).toHaveText(`${bad} now`);
  await expect(page.getByTestId('all-day')).toHaveText(`${bad} all day`);
  await expect(listRows(page).filter({ hasText: `${bad} task` })).toHaveCount(1);
  await expect(listRows(page).filter({ hasText: `${bad} later` })).toHaveCount(1);
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
});

test('WR-15 nothing picked: the app starts the day with three tasks and says so once, with no chip on the rows', async ({ page }) => {
  await boot(page, {
    tables: {
      os_tasks: [
        task('O1', { due_date: day(-12), priority: 1 }), task('O2', { due_date: day(-10) }), task('O3', { due_date: day(-8) }), task('O4', { due_date: day(-6) }),
        task('Undated'), task('Next week', { planned_for: day(5) }),
      ],
    },
  });
  await expect(nowTitle(page)).toHaveText('O1');
  await expect(page.getByTestId('start-line')).toHaveText('Nothing picked, so here is a start.');
  await expect(listRows(page)).toHaveCount(2);
  await expect(page.locator('.nc-tag')).toHaveCount(0);
  await expect(page.getByTestId('fold-older')).toContainText('1 older task');
});

test('WR-15b waiting_on does not stop a suggestion; Claude holding it or a later day does (call A)', async ({ page }) => {
  const held = task('Held', { due_date: day(-9) });
  await boot(page, {
    tables: {
      os_tasks: [held, task('Needs a yes', { waiting_on: 'a go or stop', due_date: day(-9) }), task('Next week', { planned_for: day(5) }), task('Free to do')],
      os_claude_requests: [claudeRow('Held', { task_id: held.id })],
    },
  });
  await expect(nowTitle(page)).toHaveText('Needs a yes');
  await expect(page.locator('.nc-facts')).toHaveText('Needs: a go or stop');
  expect(await listTitles(page)).toEqual(['Free to do']);
});

test('WR-15c a pick does not end the suggestions: the day tops up to three, and only "nothing picked" says so', async ({ page }) => {
  await boot(page, { tables: { os_tasks: [task('Planned', { planned_for: TODAY }), task('Undated')] } });
  await expect(nowTitle(page)).toHaveText('Planned');
  await expect(page.getByTestId('start-line')).toHaveCount(0);
  expect(await listTitles(page)).toEqual(['Undated']);
});

test('WR-16 the empty day says so and offers the next step, with no folds', async ({ page }) => {
  await boot(page, { tables: { os_calendar_state: [calState()] } });
  await expect(page.getByTestId('greeting')).toHaveText('Good morning. Nothing on today.');
  await expect(page.getByTestId('now-card')).toHaveAttribute('data-kind', 'none');
  await expect(nowTitle(page)).toHaveText('Add the first thing to do.');
  for (const s of ['plan-list', 'fold-look', 'fold-claude', 'fold-spare', 'fold-older', 'fold-done', 'all-day', 'calendar-line', 'tomorrow-line']) await expect(page.getByTestId(s)).toHaveCount(0);
  await expect(page.getByTestId('plan-link')).toHaveText('Plan tomorrow');
  await page.getByTestId('now-add').click();
  await expect(page.getByRole('dialog', { name: 'Add' })).toBeVisible();
});

test('WR-16b while the day loads it never claims to be empty', async ({ page }) => {
  await boot(page, { tables: { os_tasks: three() }, latency: 1200 });
  await expect(page.getByTestId('greeting')).toHaveText('Good morning. Opening your day.');
  await expect(nowTitle(page)).toHaveText('Alpha', { timeout: 8000 });
  await expect(page.getByTestId('greeting')).toHaveText('Good morning. 3 to do.');
});

test('WR-17 the plan link is quiet by day; from 18:00 with Now empty it is the main button and leads to Close today', async ({ page, browser }) => {
  await boot(page, { clock: '2026-10-22T17:59:00+05:30', tables: { os_tasks: three().slice(0, 1) } });
  const link = page.getByTestId('plan-link');
  await expect(link).toHaveText('Plan tomorrow');
  await expect(link).not.toHaveClass(/primary/);
  await expect(page.getByTestId('stamp')).toHaveAttribute('aria-label', 'Day shift');

  const eve = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await boot(eve, { clock: '2026-10-22T18:00:00+05:30', tables: {} });
  const close = eve.getByTestId('plan-link');
  await expect(close).toHaveText('Close today and plan tomorrow');
  await expect(close).toHaveClass(/primary/);
  await expect(eve.getByTestId('stamp')).toHaveAttribute('aria-label', 'Evening shift');
  await close.click();
  await expect(eve).toHaveURL(/#\/plan$/);
  await expect(eve.getByRole('heading', { name: 'Close today' })).toBeVisible();
  await expect(eve.getByTestId('tomorrow')).toBeVisible();
  await eve.close();
});

test('WR-17b an evening with nothing left is calm, and tomorrow first shows at the foot once it is picked', async ({ page }) => {
  await boot(page, { clock: '2026-10-22T20:00:00+05:30', tables: pitched([]) });
  await expect(nowTitle(page)).toHaveText('Nothing else today.');
  await expect(page.getByTestId('tomorrow-line')).toHaveText('Tomorrow is set. It starts with Pitch.');
});

test('WR-17c the old ?plan=1 link goes to the plan screen', async ({ page }) => {
  await boot(page, { hash: '#/?plan=1', tables: {} });
  await expect(page).toHaveURL(/#\/plan$/);
  await expect(page.getByTestId('tomorrow')).toBeVisible();
});

test('WR-18 /plan shows tomorrow\'s calendar, timed and all day, and leaves out today and task copies', async ({ page }) => {
  const t = task('Copy of a task', { planned_for: day(1) });
  await boot(page, {
    hash: '#/plan',
    tables: {
      os_tasks: [t],
      os_calendar_events: [
        calEvent('Board call', '10:00', '11:00', { starts_at: iso(day(1), '10:00'), ends_at: iso(day(1), '11:00') }),
        calEvent('Copy of a task', '12:00', '12:30', { starts_at: iso(day(1), '12:00'), ends_at: iso(day(1), '12:30'), task_id: t.id }),
        allDayEvent('Trip', day(1), day(2)),
        calEvent('Today only', '15:00', '16:00'),
      ],
    },
  });
  const list = page.getByTestId('tomorrow-calendar');
  await expect(list.locator('li')).toHaveCount(2);
  await expect(list.locator('li').nth(0)).toContainText('all day');
  await expect(list.locator('li').nth(0)).toContainText('Trip');
  await expect(list.locator('li').nth(1)).toContainText('10:00');
  await expect(list.locator('li').nth(1)).toContainText('Board call');
  await expect(page.getByRole('heading', { name: 'Already on your calendar' })).toBeVisible();
});

test('WR-18b /plan has no calendar block when tomorrow is clear', async ({ page }) => {
  await boot(page, { hash: '#/plan', tables: { os_calendar_events: [calEvent('Today only', '15:00', '16:00')] } });
  await expect(page.getByTestId('tomorrow')).toBeVisible();
  await expect(page.getByTestId('tomorrow-calendar')).toHaveCount(0);
});

test('WR-19 the calendar line: not linked', async ({ page }) => {
  await boot(page, { tables: {} });
  await expect(page.getByTestId('calendar-line')).toHaveText('Google Calendar is not linked yet. Link it in Settings.');
  await page.getByRole('link', { name: 'Google Calendar is not linked yet. Link it in Settings.' }).click(); // the line is its own fix (R4Y10)
  await expect(page).toHaveURL(/#\/settings$/);
});

test('WR-19b the calendar line: a problem shows in the owner\'s words', async ({ page }) => {
  await boot(page, { tables: { os_calendar_state: [calState({ problem: 'Google Calendar needs you to link it again.' })] } });
  await expect(page.getByTestId('calendar-line')).toHaveText('Google Calendar needs you to link it again.');
});

test('WR-19c the calendar line: linked and fresh says nothing; not checked for a while says when', async ({ page, browser }) => {
  await boot(page, { tables: { os_tasks: three().slice(0, 1), os_calendar_state: [calState({ last_ok_at: ago(10 * 60_000) })] } });
  await expect(nowTitle(page)).toHaveText('Alpha');
  await expect(page.getByTestId('calendar-line')).toHaveCount(0);

  const stale = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await boot(stale, { tables: { os_calendar_state: [calState({ last_ok_at: ago(2 * 3600_000) })] } });
  await expect(stale.getByTestId('calendar-line')).toHaveText('Google Calendar last checked 07:00.');
  await stale.close();

  const first = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await boot(first, { tables: { os_calendar_state: [calState({ last_ok_at: null })] } });
  await expect(first.getByTestId('calendar-line')).toHaveText('Google Calendar is linked. Waiting for the first check.');
  await first.close();
});

test('WR-20 offline: the plan stays readable, and Done, Not now and the ticks are off', async ({ page, context }) => {
  await boot(page, { tables: { os_tasks: three(), os_habits: [habitRow('Read')] } });
  await expect(page.getByTestId('now-done')).toBeEnabled();
  await expect(page.getByTestId('now-later')).toBeEnabled();
  await context.setOffline(true);
  await expect(page.getByTestId('offline-banner')).toBeVisible();
  await expect(nowTitle(page)).toHaveText('Alpha');
  await expect(page.getByTestId('now-done')).toBeDisabled();
  await expect(page.getByTestId('now-later')).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'Mark Bravo done' })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'Read done today' })).toBeDisabled();
  await context.setOffline(false);
  await expect(page.getByTestId('now-done')).toBeEnabled();
  expect((await db<{ status: string }>(page, 'os_tasks')).every((t) => t.status === 'open')).toBe(true);
});

test('WR-20b offline: a habit in Now cannot be ticked', async ({ page, context }) => {
  await boot(page, { tables: { os_habits: [habitRow('Read', { time_local: '09:00' })] } });
  await expect(page.getByTestId('now-card')).toHaveAttribute('data-kind', 'habit');
  await context.setOffline(true);
  await expect(page.getByTestId('now-done')).toBeDisabled();
  await context.setOffline(false);
  await page.getByTestId('now-done').click();
  await expect.poll(async () => (await db(page, 'os_habit_logs')).length).toBe(1);
  await expect(page.getByTestId('now-card')).toHaveAttribute('data-kind', 'none');
});

const GUILT = /\b(late|missed|overdue|behind)\b/i;

test('WR-21 no guilt word anywhere on the war room, with every fold open, on a day that went wrong', async ({ page }) => {
  await boot(page, {
    clock: '2026-10-22T16:00:00+05:30',
    tables: {
      os_tasks: [
        task('Client call', { planned_for: TODAY, due_date: TODAY, due_time: '10:00:00' }),
        task('Quote', { due_date: TODAY, due_time: '11:00:00' }),
        task('Write proposal', { planned_for: TODAY }),
        task('Old one', { due_date: day(-30) }), task('Old two', { due_date: day(-3), planned_for: day(-1) }),
        task('Finished', { planned_for: TODAY, status: 'done', completed_at: iso(TODAY, '09:00') }),
      ],
      os_reminders: [reminderRow('Pills', { repeat: 'daily', time_local: '08:00' }), reminderRow('Stretch', { repeat: 'daily', time_local: '17:00' })],
      os_habits: [habitRow('Walk', { time_local: '07:00' }), habitRow('Read')],
      os_calendar_events: [calEvent('Morning block', '09:00', '09:30'), calEvent('Afternoon block', '17:00', '17:30')],
      os_events: [event('Disk full', { severity: 'bad' })],
      os_claude_requests: [claudeRow('Old audit', { sent_at: ago(5 * 3600_000) })],
      os_campaign_snapshots: [snapRow({ campaign_id: 'E1', campaign_name: 'E1', sent_total: 150, bounces_total: 9 })],
    },
  });
  await expect(nowTitle(page)).toHaveText('Client call');
  for (const f of ['look', 'claude', 'older', 'done']) await openFold(page, f);
  const text = await page.locator('body').innerText();
  expect(text).toContain('Old one');
  expect(text).not.toMatch(GUILT);
});

for (const [name, clock] of [['morning', '2026-10-22T09:00:00+05:30'], ['night', '2026-10-22T22:30:00+05:30']] as const) {
  test(`WR-21b no guilt word on the sample day, ${name}`, async ({ page }) => {
    await boot(page, { clock });
    await expect(page.getByTestId('now-card')).toBeVisible();
    for (const f of ['look', 'claude', 'spare', 'older', 'done']) if (await page.getByTestId(`fold-${f}`).count()) await openFold(page, f);
    expect(await page.locator('body').innerText()).not.toMatch(GUILT);
  });
}

test('WR-22 what is not the plan sits behind a fold that opens on tap', async ({ page }) => {
  await boot(page, {
    tables: {
      os_tasks: [...three(), task('Old one', { due_date: day(-4) })],
      os_events: [event('Disk full', { severity: 'bad' })],
      os_claude_requests: [claudeRow('Audit')],
    },
  });
  await expect(nowTitle(page)).toHaveText('Alpha');
  for (const s of ['sec-now', 'sec-claude', 'sec-older']) await expect(page.getByTestId(s)).toHaveCount(0);
  await expect(page.getByTestId('fold-look')).toContainText('1 thing needs a look');
  await expect(page.getByTestId('fold-claude')).toContainText('1 with Claude');
  await expect(page.getByTestId('fold-older')).toContainText('1 older task');
  await openFold(page, 'look');
  await expect(page.getByTestId('sec-now')).toContainText('Disk full');
  await page.getByTestId('fold-look').click();
  await expect(page.getByTestId('sec-now')).toHaveCount(0);
});

test('WR-22b tasks that do not fit before the day ends fold into More if there is time', async ({ page }) => {
  await boot(page, {
    clock: '2026-10-22T22:40:00+05:30',
    tables: { os_tasks: Array.from({ length: 4 }, (_, i) => task(`P${i}`, { planned_for: TODAY, sort_order: i, est_minutes: 30 })) },
  });
  await expect(nowTitle(page)).toHaveText('P0');
  await expect(page.getByTestId('plan-list')).toHaveCount(0); // P0 runs past 23:00, so nothing starts after it
  await expect(page.getByTestId('fold-spare')).toContainText('3 more if there is time');
  await openFold(page, 'spare');
  await expect(page.getByTestId('sec-spare').getByTestId('plan-row')).toHaveCount(3);
});

test('WR-23 a reminder is a mark at its time: it can be ticked and opened, and never holds Now', async ({ page }) => {
  await boot(page, { tables: { os_reminders: [reminderRow('Stretch', { repeat: 'daily', time_local: '10:00' })] } });
  await expect(page.getByTestId('now-card')).toHaveAttribute('data-kind', 'none');
  const row = listRows(page).filter({ hasText: 'Stretch' });
  await expect(row).toHaveAttribute('data-kind', 'reminder');
  await expect(row.locator('.wl-time')).toHaveText('10:00');
  await row.getByRole('button', { name: /Stretch/ }).click();
  await expect(page.getByLabel('Title')).toHaveValue('Stretch');
  await page.keyboard.press('Escape');
  await row.getByRole('checkbox', { name: 'Stretch done' }).click();
  await expect(listRows(page).filter({ hasText: 'Stretch' })).toHaveCount(0);
});

test('WR-24 Settings has a Google Calendar section in plain words', async ({ page, browser }) => {
  await boot(page, { hash: '#/settings', tables: {} });
  await expect(page.getByRole('heading', { name: 'Google Calendar' })).toBeVisible();
  await expect(page.getByTestId('calendar-linked')).toHaveText('not yet');
  const sec = page.locator('section', { has: page.getByRole('heading', { name: 'Google Calendar' }) });
  await expect(sec).toContainText('never');
  await expect(sec).toContainText('Once linked, a task with a date and a time goes on your calendar');
  await expect(page.getByTestId('calendar-howto')).toHaveText('Ask Claude to link it from the Mac, then press Allow.');

  const on = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await boot(on, { hash: '#/settings', tables: { os_calendar_state: [calState()] } });
  await expect(on.getByTestId('calendar-linked')).toHaveText('yes');
  const onSec = on.locator('section', { has: on.getByRole('heading', { name: 'Google Calendar' }) });
  await expect(onSec).not.toContainText('never');
  await expect(onSec).toContainText('What is on your calendar shows on Today.');
  await on.close();

  const bad = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await boot(bad, { hash: '#/settings', tables: { os_calendar_state: [calState({ problem: 'Google Calendar needs you to link it again.' })] } });
  await expect(bad.locator('section', { has: bad.getByRole('heading', { name: 'Google Calendar' }) })).toContainText('needs you to link it again');
  await bad.close();
});

test('WR-25 the task sheet says a timed task goes on the calendar, only once linked and with a date and a time', async ({ page }) => {
  const hint = 'Goes on Google Calendar.';
  await boot(page, { tables: { os_tasks: [task('Call Sam', { planned_for: TODAY, due_date: TODAY, due_time: '15:00:00' }), task('No time', { due_date: TODAY, planned_for: TODAY })], os_calendar_state: [calState()] } });
  await page.getByRole('button', { name: 'Open Call Sam' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Task' })).toContainText(hint);
  await page.keyboard.press('Escape');
  await nowTitle(page).click();
  await expect(page.getByLabel('Title')).toHaveValue('No time');
  await expect(page.getByRole('dialog', { name: 'Task' })).not.toContainText(hint);
});

test('WR-25b while the calendar is not linked a timed task says it stayed off Google, and carries no calendar mark', async ({ page }) => {
  await boot(page, { tables: { os_tasks: [task('Call Sam', { planned_for: TODAY, due_date: TODAY, due_time: '15:00:00' })] } });
  await page.getByRole('button', { name: 'Open Call Sam' }).click();
  await expect(page.getByLabel('Title')).toHaveValue('Call Sam');
  await expect(page.getByRole('dialog', { name: 'Task' })).toContainText('Stays off Google until the calendar is linked.');
  await page.keyboard.press('Escape');
  await expect(listRows(page).filter({ hasText: 'Call Sam' }).getByTestId('on-google')).toHaveCount(0);
});

test('WR-26 Add to switches the area of a captured task, and the task lands in the plan with its tag', async ({ page }) => {
  await boot(page, { tables: {} });
  await page.getByTestId('add').click();
  const dlg = page.getByRole('dialog', { name: 'Add' });
  await expect(dlg.getByRole('button', { name: 'Work', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await dlg.getByRole('textbox', { name: 'Quick add' }).fill('Call mum today');
  await dlg.getByRole('button', { name: 'Personal', exact: true }).click();
  await expect(page.getByTestId('capture-preview')).toContainText('personal');
  await dlg.getByRole('button', { name: 'Save task' }).click();
  await expect.poll(async () => (await db<{ area: string }>(page, 'os_tasks'))[0]?.area).toBe('personal');
  await expect(nowTitle(page)).toHaveText('Call mum');
  // the next add starts on the area of the last one, in the same order as everywhere else (R4P33)
  await page.getByTestId('add').click();
  const again = page.getByRole('dialog', { name: 'Add' });
  await expect(again.getByRole('group', { name: 'Add to' }).getByRole('button')).toHaveText(['Personal', 'Work']);
  await expect(again.getByRole('button', { name: 'Personal', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('WR-27 the clock used by the plan is IST on a device in another timezone', async ({ page }) => {
  await boot(page, { clock: new Date(NOW_MS).toISOString(), tables: { os_calendar_events: [calEvent('Standup', '09:00', '09:30')] } });
  await expect(nowTitle(page)).toHaveText('Standup');
  await expect(nowLine(page)).toHaveText('Until 09:30.');
});

test('WR-28 the day line is a wide-screen thing: a phone never shows it', async ({ page }) => {
  await boot(page, { tables: { os_tasks: three() } });
  await expect(nowTitle(page)).toHaveText('Alpha');
  await expect(page.getByTestId('dayline')).toHaveCount(0);
});

// ---- QA round 4: calls A to M on the screen ---------------------------------------------------
const skip = async (page: Page) => (await db<{ key: string; value: { ids: string[]; more: number } }>(page, 'os_settings')).find((r) => r.key === 'plan_skip')?.value;
const noSkip = () => settings({ plan_skip: null });

test('WR-30 Not now on a suggestion swaps in the next one for the day, with Undo, and task 4 can be reached (call E)', async ({ page }) => {
  const tasks = ['S1', 'S2', 'S3', 'S4', 'S5'].map((t, i) => task(t, { sort_order: i, updated_at: ago((9 - i) * 86_400_000) }));
  await boot(page, { tables: { os_tasks: tasks } });
  await expect(nowTitle(page)).toHaveText('S1');
  await page.getByTestId('now-later').click();
  await expect(nowTitle(page)).toHaveText('S2');
  expect(await listTitles(page)).toEqual(['S3', 'S4']);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(nowTitle(page)).toHaveText('S1');
  await page.getByTestId('now-later').click();
  await expect(nowTitle(page)).toHaveText('S2');
  await expect.poll(async () => (await skip(page))?.ids.includes(tasks[0].id as string)).toBe(true);
  await page.reload();
  await expect(nowTitle(page)).toHaveText('S2');
});

test('WR-31 Finished early moves the plan on and changes only the skip list (R4P16)', async ({ page }) => {
  const lunch = calEvent('Lunch', '08:30', '09:30');
  await boot(page, { tables: { os_tasks: three().slice(0, 1), os_calendar_events: [lunch] } });
  await expect(nowTitle(page)).toHaveText('Lunch');
  await page.getByTestId('now-finished').click();
  await expect(nowTitle(page)).toHaveText('Alpha');
  expect((await db(page, 'os_calendar_events'))).toHaveLength(1);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(nowTitle(page)).toHaveText('Lunch');
});

test('WR-32 after three done the plan says so, and One more lets one in (call F)', async ({ page }) => {
  const done = ['D1', 'D2', 'D3'].map((t) => task(t, { planned_for: TODAY, status: 'done', completed_at: iso(TODAY, '08:30') }));
  await boot(page, { tables: { os_tasks: [...done, task('Waiting in the wings')], os_calendar_events: [calEvent('Lunch', '12:00', '13:00')] } });
  await expect(nowTitle(page)).toHaveText('That was the plan.');
  await expect(page.getByTestId('now-card')).toHaveAttribute('data-kind', 'finished');
  await expect(nowLine(page)).toHaveText('Free until Lunch at 12:00.');
  await page.getByTestId('one-more').click();
  await expect(nowTitle(page)).toHaveText('Waiting in the wings');
  await expect.poll(async () => (await skip(page))?.more).toBe(1);
});

test('WR-33 from 21:00 Plan tomorrow is Now with one button, and a reminder of that name does not also show (call H)', async ({ page }) => {
  await boot(page, {
    clock: '2026-10-22T21:10:00+05:30',
    tables: { os_settings: noSkip() as never, os_tasks: three().slice(0, 1), os_reminders: [reminderRow('Plan tomorrow', { repeat: 'daily', time_local: '21:15' })] },
  });
  await expect(nowTitle(page)).toHaveText('Plan tomorrow');
  await expect(nowLine(page)).toHaveText('Pick what tomorrow starts with.');
  await expect(listRows(page).filter({ hasText: 'Plan tomorrow' })).toHaveCount(0);
  await page.getByTestId('now-plan').click();
  await expect(page).toHaveURL(/#\/plan$/);
});

test('WR-33b before 21:00 the step is a row at its time', async ({ page }) => {
  await boot(page, { tables: { os_settings: noSkip() as never, os_tasks: three().slice(0, 1) } });
  const step = listRows(page).filter({ hasText: 'Plan tomorrow' });
  await expect(step).toHaveAttribute('data-kind', 'step');
  await expect(step.locator('.wl-t')).toHaveText('21:00');
});

test('WR-33c with tomorrow picked there is no step', async ({ page }) => {
  await boot(page, { tables: { os_settings: noSkip() as never, ...pitched(three().slice(0, 1)) } });
  await expect(nowTitle(page)).toHaveText('Alpha');
  await expect(page.locator('[data-kind="step"]')).toHaveCount(0);
});

test('WR-34 at 23:30 the day is done: no task, no suggestion, no older fold, and the closing line (call I)', async ({ page }) => {
  await boot(page, { clock: '2026-10-22T23:30:00+05:30', tables: pitched([...three(), task('Old', { due_date: day(-3) })]) });
  await expect(page.getByTestId('now-card')).toHaveAttribute('data-kind', 'night');
  await expect(nowTitle(page)).toHaveText('Day is done.');
  await expect(nowLine(page)).toHaveText('Tomorrow is set. It starts with Pitch.');
  for (const s of ['plan-list', 'fold-spare', 'fold-older', 'fold-rest']) await expect(page.getByTestId(s)).toHaveCount(0);
  await expect(page.getByTestId('greeting')).toHaveText('Good night.');
  await expect(page.getByTestId('stamp')).toHaveAttribute('aria-label', 'Night shift');
});

test('WR-34b at 00:30 it stays quiet and the closing line names the first pick of the new date', async ({ page }) => {
  await boot(page, { clock: '2026-10-22T00:30:00+05:30', tables: { os_tasks: three(), os_calendar_events: [calEvent('Lunch', '12:00', '13:00')] } });
  await expect(nowTitle(page)).toHaveText('Day is done.');
  await expect(nowLine(page)).toHaveText('Tomorrow is set. It starts with Alpha.');
  await expect(page.getByTestId('plan-list')).toHaveCount(0);
});

test('WR-35 with no task and a fixed thing far off, Now reads Free until; inside 30 minutes the thing is Now (call C)', async ({ page, browser }) => {
  const tables = () => ({ os_calendar_events: [calEvent('Client call', '11:30', '12:00')] });
  await boot(page, { tables: tables() });
  await expect(page.getByTestId('now-card')).toHaveAttribute('data-kind', 'free');
  await expect(nowTitle(page)).toHaveText('Free until Client call at 11:30.');
  await expect(listRows(page).first().locator('.wl-word')).toHaveText('Next');
  const near = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await boot(near, { clock: '2026-10-22T11:05:00+05:30', tables: tables() });
  await expect(nowTitle(near)).toHaveText('Client call');
  await expect(nowLine(near)).toHaveText('Starts at 11:30, in 25 min.');
  await near.close();
});

test('WR-36 first view: Next and three rows, the rest behind one fold in the same order (call L)', async ({ page }) => {
  await boot(page, { tables: { os_tasks: Array.from({ length: 8 }, (_, i) => task(`P${i}`, { planned_for: TODAY, sort_order: i })) } });
  await expect(listRows(page)).toHaveCount(4);
  await expect(page.getByTestId('fold-rest')).toContainText('Rest of today 3');
  await openFold(page, 'rest');
  expect(await page.getByTestId('sec-rest').locator('.t1').allInnerTexts()).toEqual(['P5', 'P6', 'P7']);
});

test('WR-37 what needs a look sits above Now, and the morning shows the line written for today (call M)', async ({ page, browser }) => {
  const tables = () => ({
    os_tasks: three().slice(0, 1), os_events: [event('Inbox disconnected', { severity: 'bad' })],
    os_days: [{ day: TODAY, plan: 'Close the billing', review: null, top_task_ids: [], mood: null }],
  });
  await boot(page, { tables: tables() });
  const y = async (id: string) => (await page.getByTestId(id).boundingBox())!.y;
  await expect(page.getByTestId('day-line')).toHaveText('Close the billing');
  expect(await y('fold-look')).toBeLessThan(await y('now-card'));
  expect(await y('day-line')).toBeLessThan(await y('now-card'));
  const noon = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await boot(noon, { clock: '2026-10-22T12:00:00+05:30', tables: tables() });
  await expect(noon.getByTestId('now-card')).toBeVisible();
  await expect(noon.getByTestId('day-line')).toHaveCount(0);
  await noon.close();
});

test('WR-38 a ticked habit and a ticked reminder get the same Undo, join the Done fold and the count (R4P09)', async ({ page }) => {
  await boot(page, { tables: { os_habits: [habitRow('Stretch')], os_reminders: [reminderRow('Pills', { repeat: 'daily', time_local: '10:00' })] } });
  await page.getByRole('checkbox', { name: 'Stretch done today' }).click();
  await expect(page.getByText('Done: Stretch')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('checkbox', { name: 'Stretch done today' })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Stretch done today' }).click();
  await page.getByRole('checkbox', { name: 'Pills done' }).click();
  await expect(page.getByText('Done: Pills')).toBeVisible();
  await expect(page.getByTestId('fold-done')).toContainText('2 done today');
  await expect(page.getByTestId('greeting')).toHaveText('Good morning. That is everything for today, 2 done.');
  await openFold(page, 'done');
  await page.getByRole('checkbox', { name: 'Reopen Pills' }).click();
  await expect(listRows(page).filter({ hasText: 'Pills' })).toHaveCount(1);
  await expect(page.getByTestId('fold-done')).toContainText('1 done today');
});

test('WR-39 Tomorrow gets a toast with Undo that puts the day, the date and the order back (R4P09)', async ({ page }) => {
  const t = task('Call Sam', { planned_for: TODAY, due_date: TODAY, due_time: '15:00:00' });
  const [a] = three();
  await boot(page, { tables: { os_tasks: [a, t], os_days: [{ day: TODAY, plan: null, review: null, top_task_ids: [a.id as string, t.id as string], mood: null }] } });
  await rowAction(page, 'Call Sam', 'Move Call Sam to tomorrow');
  await expect(page.getByText('Moved to tomorrow: Call Sam')).toBeVisible();
  const row = async () => (await db<{ title: string; planned_for: string; due_date: string }>(page, 'os_tasks')).find((x) => x.title === 'Call Sam');
  await expect.poll(async () => (await row())?.due_date).toBe(day(1));
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await row())?.due_date).toBe(TODAY);
  await expect.poll(async () => (await row())?.planned_for).toBe(TODAY);
  await expect.poll(() => order(page)).toEqual([a.id, t.id]);
});

test('WR-40 a double tap on Done closes one task, and the next Done is not live yet (R4U01)', async ({ page }) => {
  await boot(page, { tables: { os_tasks: three() } });
  await expect(nowTitle(page)).toHaveText('Alpha');
  await page.getByTestId('now-done').evaluate((b: HTMLElement) => { b.click(); b.click(); });
  await expect(nowTitle(page)).toHaveText('Bravo');
  await expect.poll(async () => (await db<{ status: string }>(page, 'os_tasks')).filter((t) => t.status === 'done').length).toBe(1);
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(1); // one toast, naming the task
  await expect(page.getByText('Done: Alpha')).toBeVisible();
});

test('WR-41 a ticked row holds its strike, so the next row never slides under the thumb (R4U02)', async ({ page }) => {
  await boot(page, { tables: { os_tasks: three() } });
  const row = listRows(page).filter({ hasText: 'Bravo' });
  await row.getByRole('checkbox', { name: 'Mark Bravo done' }).click();
  await expect(row).toHaveClass(/leaving/);
  await expect(row).toHaveCount(1);
  await expect(row).toHaveCount(0);
  await expect(page.getByText('Done: Bravo')).toBeVisible();
});

test('WR-42 a long string never makes the page scroll sideways, and the Now title stays in four lines (R4U04)', async ({ page }) => {
  const long = 'x'.repeat(120);
  await boot(page, { tables: { os_tasks: [task(long, { planned_for: TODAY, next_action: long }), task(`${long}2`, { planned_for: TODAY })], os_habits: [habitRow(long)], os_reminders: [reminderRow(long, { repeat: 'daily', time_local: '10:00' })] } });
  await expect(page.getByTestId('now-card')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const h = await nowTitle(page).evaluate((e) => e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight));
  expect(h).toBeLessThanOrEqual(4.5);
});

test('WR-43 a new Now is announced, and when Done goes away focus comes to Now, not the page (R4U05)', async ({ page }) => {
  await boot(page, { tables: { os_tasks: three().slice(0, 1), os_calendar_events: [calEvent('Standup', '09:10', '09:30')] } });
  await expect(page.getByTestId('now-live')).toHaveText('Now: Alpha');
  await page.getByTestId('now-done').focus();
  await page.getByTestId('now-done').press('Enter');
  await expect(page.getByTestId('now-live')).toHaveText('Now: Standup');
  await expect(page.locator('#h-nowcard')).toBeFocused();
});

test('WR-44 linked: a timed task carries the calendar mark and the add line says where it goes (R4P13)', async ({ page }) => {
  await boot(page, { tables: { os_tasks: [task('Call Sam', { due_date: TODAY, due_time: '15:00:00' })], os_calendar_state: [calState()] } });
  await expect(listRows(page).filter({ hasText: 'Call Sam' }).getByTestId('on-google')).toBeVisible();
  await page.getByTestId('add').click();
  await page.getByRole('textbox', { name: 'Quick add' }).fill('Dentist tomorrow 3pm');
  await expect(page.getByTestId('capture-preview')).toContainText('Goes on Google Calendar.');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Added: Dentist, Tomorrow 15:00. Goes on Google Calendar.')).toBeVisible();
});

test('WR-45 a time with no date takes the planned day, and the sheet says so (R4P14)', async ({ page }) => {
  await boot(page, { tables: { os_tasks: [task('Alpha', { planned_for: TODAY })] } });
  await nowTitle(page).click();
  await page.getByLabel('Due time').fill('15:30');
  await expect(page.getByRole('dialog', { name: 'Task' })).toContainText('A time needs a day, so this is set for 22 Oct.');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await db<{ due_date: string }>(page, 'os_tasks'))[0].due_date).toBe(TODAY);
});

test('WR-46 adding a task already on today offers no Today button (R4P32)', async ({ page }) => {
  await boot(page, { tables: {} });
  await page.getByTestId('add').click();
  await page.getByRole('textbox', { name: 'Quick add' }).fill('Call Sam 3pm');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/^Added: Call Sam, Today 15:00/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Today', exact: true })).toHaveCount(0);
});

test('WR-47 /plan before 18:00 is Plan tomorrow, with no closed line and no habit count (R4P25)', async ({ page }) => {
  await boot(page, { hash: '#/plan', tables: { os_habits: [habitRow('Read')] } });
  await expect(page.getByTestId('stamp')).toHaveAttribute('aria-label', 'Plan tomorrow');
  await expect(page.getByTestId('greeting')).toHaveText('Pick what tomorrow starts with.');
  await expect(page.getByTestId('habits-left')).toHaveCount(0);
});

test('WR-48 a 320 px phone has no sideways scroll and Done clears the tab bar (R4U25)', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await boot(page, { tables: { os_tasks: three() } });
  await expect(page.getByTestId('now-card')).toBeVisible();
  await expect(page.getByTestId('stamp')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const done = (await page.getByTestId('now-done').boundingBox())!;
  const bar = (await page.locator('.tabbar').boundingBox())!;
  expect(done.y + done.height).toBeLessThanOrEqual(bar.y);
});

test('WR-50 a habit whose time has ended waits in a closed fold under the plan, and a tick takes it to Done (R4Y02)', async ({ page }) => {
  await boot(page, { clock: '2026-10-22T16:02:00+05:30', tables: { os_tasks: three(), os_habits: [habitRow('Gym', { time_local: '14:15' })], os_calendar_events: [calEvent('Gym', '14:30', '16:00')] } });
  await expect(nowTitle(page)).toHaveText('Alpha');
  await expect(page.getByTestId('fold-ticks')).toContainText('1 habit to tick');
  await expect(page.getByTestId('sec-ticks')).toHaveCount(0); // closed until asked for
  const y = async (id: string) => (await page.getByTestId(id).boundingBox())!.y;
  expect(await y('fold-ticks')).toBeGreaterThan(await y('now-card'));
  await openFold(page, 'ticks');
  await page.getByTestId('sec-ticks').getByRole('checkbox', { name: 'Gym done today' }).click();
  await expect.poll(async () => (await db<{ habit_id: string; day: string }>(page, 'os_habit_logs')).filter((l) => l.day === TODAY).map((l) => l.habit_id)).toEqual(['h-Gym']);
  await expect(page.getByText('Done: Gym')).toBeVisible();
  await expect(page.getByTestId('fold-ticks')).toHaveCount(0);
  await expect(page.getByTestId('fold-done')).toContainText('1 done today');
});

test('WR-50b at night it is still there, with no plan around it, and a habit skipped for the day is not (R4Y02)', async ({ page }) => {
  await boot(page, {
    clock: '2026-10-22T23:30:00+05:30',
    tables: { os_habits: [habitRow('Flute', { time_local: '19:00' }), habitRow('Walk', { time_local: '21:30' })], os_settings: settings({ plan_skip: { day: TODAY, ids: ['plan-tomorrow', 'h-Walk'], more: 0 } }) as never },
  });
  await expect(nowTitle(page)).toHaveText('Day is done.');
  await expect(page.getByTestId('fold-ticks')).toContainText('1 habit to tick');
});

test('WR-51 3 done with a timed task still to come: That was the plan, the free time, and One more (R4Y03)', async ({ page }) => {
  const closed = (t: string) => task(t, { planned_for: TODAY, status: 'done', completed_at: ago(3600_000) });
  await boot(page, { tables: { os_tasks: [closed('X'), closed('Y'), closed('Z'), task('Left'), task('Call Sam', { due_date: TODAY, due_time: '15:00:00' })] } });
  await expect(page.getByTestId('now-card')).toHaveAttribute('data-kind', 'finished');
  await expect(nowLine(page)).toHaveText('Free until Call Sam at 15:00.');
  await page.getByTestId('one-more').click();
  await expect(nowTitle(page)).toHaveText('Left');
});

test('WR-51b three tasks timed for later leave the morning full (R4Y03)', async ({ page }) => {
  await boot(page, { tables: { os_tasks: [...['13:00', '15:00', '17:00'].map((h, i) => task(`Timed ${i}`, { due_date: TODAY, due_time: `${h}:00` })), task('Undated')] } });
  await expect(page.getByTestId('now-card')).toHaveAttribute('data-kind', 'task');
  await expect(nowTitle(page)).toHaveText('Undated');
});

test('WR-52 a task pushed to tomorrow is not a plan: the foot stays quiet and the evening step stays (R4Y05)', async ({ page }) => {
  const [a, b] = three();
  await boot(page, { tables: { os_settings: noSkip() as never, os_tasks: [a, b] } });
  await rowAction(page, 'Alpha', 'Move Alpha to tomorrow', page.getByTestId('now-card'));
  await expect(nowTitle(page)).toHaveText('Bravo');
  await expect.poll(async () => (await db<{ title: string; planned_for: string }>(page, 'os_tasks')).find((t) => t.title === 'Alpha')?.planned_for).toBe(day(1));
  await expect(page.getByTestId('tomorrow-line')).toHaveCount(0);
  await expect(listRows(page).filter({ hasText: 'Plan tomorrow' })).toHaveCount(1);
});

test('WR-52b at 21:10 and at 23:30 a pushed task does not read as tomorrow being set (R4Y05)', async ({ page }) => {
  const tables = { os_settings: noSkip() as never, os_tasks: [task('Blue Heron', { planned_for: day(1) })] };
  await boot(page, { clock: '2026-10-22T21:10:00+05:30', tables });
  await expect(page.getByTestId('now-card')).toHaveAttribute('data-kind', 'step');
  await expect(page.getByTestId('tomorrow-line')).toHaveCount(0);
  await page.clock.fastForward('02:20:00');
  await expect(nowTitle(page)).toHaveText('Day is done.');
  await expect(nowLine(page)).toHaveText('Nothing picked. Tomorrow starts with the oldest tasks.');
});

test('WR-53 what is still running behind Now says after, not its old time (R4Y09)', async ({ page }) => {
  await boot(page, { tables: { os_calendar_events: [calEvent('Focus block', '08:00', '10:00'), calEvent('Client call', '08:55', '09:30'), calEvent('Lunch', '12:00', '13:00')] } });
  await expect(nowTitle(page)).toHaveText('Client call');
  await expect(listRows(page).first().locator('.wl-word')).toHaveText('Next');
  await expect(listRows(page).first().locator('.wl-t')).toHaveText('after');
  await expect(listRows(page).filter({ hasText: 'Lunch' }).locator('.wl-t')).toHaveText('12:00');
});

test('WR-54 the head line counts habits and calendar rows as set times, once linked or not (R4Y10)', async ({ page }) => {
  await boot(page, { tables: { os_tasks: [task('One', { planned_for: TODAY })], os_habits: [habitRow('Gym', { time_local: '14:15' })], os_calendar_events: [calEvent('Lunch', '12:00', '13:00')] } });
  await expect(page.getByTestId('greeting')).toHaveText('Good morning. 1 to do, 2 at set times.');
});

test('WR-55 the start line only shows under a suggestion that is Now (R4Y11)', async ({ page }) => {
  const os_tasks = [task('Undated one'), task('Undated two')];
  await boot(page, { clock: '2026-10-22T12:10:00+05:30', tables: { os_tasks, os_calendar_events: [calEvent('Lunch', '12:00', '13:00')] } });
  await expect(nowTitle(page)).toHaveText('Lunch');
  await expect(page.getByTestId('start-line')).toHaveCount(0);
});

test('WR-55b once tomorrow is picked the evening does not say nothing is picked (R4Y11)', async ({ page }) => {
  await boot(page, { clock: '2026-10-22T21:12:00+05:30', tables: pitched([task('Undated one')]) });
  await expect(nowTitle(page)).toHaveText('Undated one');
  await expect(page.getByTestId('start-line')).toHaveCount(0);
});

test('WR-56 a task keeps the hold that pins Done, and Lunch leaves no hole (R4Y13)', async ({ page }) => {
  const hold = () => page.locator('.nc-swap').evaluate((e) => getComputedStyle(e).minHeight);
  await boot(page, { tables: { os_tasks: three() } });
  await expect(nowTitle(page)).toHaveText('Alpha');
  expect(await hold()).toBe('150px');
});

test('WR-56b a fixed thing on Now holds 96 px, and an empty Now holds nothing (R4Y13)', async ({ page }) => {
  const hold = () => page.locator('.nc-swap').evaluate((e) => getComputedStyle(e).minHeight);
  await boot(page, { clock: '2026-10-22T12:10:00+05:30', tables: { os_calendar_events: [calEvent('Lunch', '12:00', '13:00')] } });
  await expect(page.getByTestId('now-card')).toHaveAttribute('data-kind', 'event');
  expect(await hold()).toBe('96px');
  await page.clock.fastForward('01:00:00');
  await expect(page.getByTestId('now-card')).toHaveAttribute('data-kind', 'none');
  expect(await hold()).toBe('0px');
});

test('WR-57 a suggestion and a habit say Not today, the evening step keeps Not now (R4Y16)', async ({ page }) => {
  await boot(page, { tables: { os_tasks: [task('Undated'), task('Other')] } });
  await expect(page.getByTestId('now-later')).toHaveText('Not today');
  await page.getByTestId('now-later').click();
  await expect(page.getByText('Not today: Undated')).toBeVisible();
  await expect(nowTitle(page)).toHaveText('Other');
});

test('WR-57b a habit on Now says Not today, and the evening step says Not now (R4Y16)', async ({ page }) => {
  await boot(page, { clock: '2026-10-22T14:20:00+05:30', tables: { os_habits: [habitRow('Gym', { time_local: '14:15' })] } });
  await expect(nowTitle(page)).toHaveText('Gym');
  await expect(page.getByTestId('now-later')).toHaveText('Not today');
  const eve = await page.context().newPage();
  await boot(eve, { clock: '2026-10-22T21:05:00+05:30', tables: { os_settings: noSkip() as never } });
  await expect(eve.getByTestId('now-later')).toHaveText('Not now');
  await eve.close();
});

test('WR-58 no stray rules: no folds means no line, and Next at the end of the list has no second one (R4Y18)', async ({ page }) => {
  await boot(page, { tables: { os_tasks: three().slice(0, 2) } });
  await expect(listRows(page)).toHaveCount(1);
  await expect(page.locator('.folds')).toBeHidden();
  await expect(listRows(page).first()).toHaveCSS('border-bottom-width', '0px');
});

test('WR-58b Next with rows under it keeps its rule, and a fold brings the folds line back (R4Y18)', async ({ page }) => {
  await boot(page, { tables: { os_tasks: [...three(), task('Old', { due_date: day(-3) })] } });
  await expect(listRows(page).first()).toHaveCSS('border-bottom-width', '1px');
  await expect(page.locator('.folds')).toBeVisible();
});

test('WR-59 a timed event that began days ago reaches the screen as a quiet line, and never holds Now (R4X11)', async ({ page }) => {
  await boot(page, { tables: { os_tasks: three(), os_calendar_events: [calEvent('Conference', '09:00', '18:00', { starts_at: iso(day(-2), '09:00'), ends_at: iso(day(1), '18:00') })] } });
  await expect(page.getByTestId('all-day')).toHaveText('Conference');
  await expect(nowTitle(page)).toHaveText('Alpha');
});
