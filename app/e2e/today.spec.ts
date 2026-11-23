/**
 * Stories covered: TD-01 TD-04 TD-07 TD-10 TD-11 TD-13 TD-17 TD-18 TD-19 TD-20 TD-21 TD-22 TD-23 TD-24 TD-25 TD-26 TD-27
 * TD-28 TD-30 TD-31, FU-09, on the two screens that replaced the sheet (logs/qa-r4-plan.md decision 9). `/` is the war room
 * (Now, Next, the rest, folds; warroom.spec.ts holds what is new there). `#/plan` keeps the ruled sheet rows: the spine, the
 * band words, Done in place, Claude on the row. What used to be TD-03, TD-16, TD-29, TD-33, TD-34 and TD-36 went with the
 * morning sheet; WR-01, WR-05, WR-06c, WR-07 and WR-16 cover what took their place.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  NOW, TODAY, boot, claudeRow, day, db, event, external, habitRow, iso, log, openFold, reminderRow, rowAction, settings, snapRow, task,
} from './helpers';

const todoTasks = () => [
  task('A', { planned_for: TODAY, est_minutes: 20, sort_order: 1 }),
  task('B', { planned_for: TODAY, sort_order: 2 }),
  task('O1', { due_date: day(-12), est_minutes: 10 }),
  task('O2', { due_date: day(-10), est_minutes: 15 }),
  task('O3', { due_date: day(-8), est_minutes: 5 }),
  task('O4', { due_date: day(-6), est_minutes: 8 }),
];
type Sec = 'sec-now' | 'sec-today' | 'sec-older' | 'sec-claude' | 'plan-list';
/** Row titles in one section, in order. */
const titles = (page: Page, sec: Sec) => page.getByTestId(sec).locator('[data-testid="sheet-row"], [data-testid="plan-row"], [data-testid="habit-row"], [data-testid="claude-row"]').locator('.t1').allInnerTexts();
const nowTitle = (page: Page) => page.getByTestId('now-title');
const planRow = (page: Page, title: string) => page.getByTestId('plan-row').filter({ hasText: title });
const req = (id: string, title: string, status: string, over: Record<string, unknown> = {}) => ({
  id, area: 'work', task_id: null, title, brief: title, status, handoff: 'routine', session_url: null, result: null, error: null, attempts: 0, seen_at: null,
  sent_at: status === 'sent' ? new Date(NOW).toISOString() : null, finished_at: null, created_at: new Date(NOW).toISOString(), updated_at: new Date(NOW).toISOString(), ...over,
});

test('TD-01 greeting switches at 12:00 and 18:00 IST', async ({ page, browser }) => {
  await boot(page, { clock: '2026-10-22T11:59:00+05:30' });
  await expect(page.getByTestId('greeting')).toContainText(/^Good morning\./);
  const p2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await boot(p2, { clock: '2026-10-22T12:00:00+05:30' });
  await expect(p2.getByTestId('greeting')).toContainText(/^Good afternoon\./);
  await p2.close();
  const p3 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await boot(p3, { clock: '2026-10-22T18:00:00+05:30' });
  await expect(p3.getByTestId('greeting')).toContainText(/^Good evening\./);
  await p3.close();
});

test('TD-03b a mood tap sends only the mood, so the plan and review saved elsewhere survive (D5)', async ({ page }) => {
  await boot(page, { hash: '#/plan', tables: { os_tasks: [], os_days: [{ day: TODAY, plan: 'Kept plan', review: 'Kept review', top_task_ids: [], mood: null }] } });
  await expect(page.getByTestId('situation-ro')).toHaveText('Kept plan');
  // another device changes the plan after this page loaded; this page still holds the old text
  await page.evaluate((d) => (window as unknown as { __mock: { externalUpdate(t: string, m: object, p: object): void } }).__mock.externalUpdate('os_days', { day: d }, { plan: 'From the phone' }), TODAY);
  await page.getByRole('button', { name: 'Mood 3' }).click();
  await expect.poll(async () => (await db<{ day: string; mood: number }>(page, 'os_days')).find((d) => d.day === TODAY)?.mood).toBe(3);
  expect((await db<{ day: string; plan: string; review: string }>(page, 'os_days')).find((d) => d.day === TODAY)).toMatchObject({ plan: 'From the phone', review: 'Kept review' });
});

test('TD-04 the plan comes first, the overdue backlog folds into one line, and its rows show a plain date', async ({ page }) => {
  await boot(page, { tables: { os_tasks: todoTasks() } });
  await expect(nowTitle(page)).toHaveText('A');
  expect(await titles(page, 'plan-list')).toEqual(['B', 'O1']); // two picks, topped up to three
  await expect(page.getByTestId('fold-look')).toHaveCount(0);
  await expect(page.getByTestId('greeting')).toHaveText('Good morning. 3 to do.');
  await expect(page.getByTestId('fold-older')).toContainText('3 older tasks');
  await expect(page.getByTestId('sec-older')).toHaveCount(0);
  await openFold(page, 'older');
  expect(await titles(page, 'sec-older')).toEqual(['O2', 'O3', 'O4']);
  // the due date shows in plain ink, never "-10d" or "late" (QA r2 C26)
  const o2 = page.getByTestId('sec-older').getByTestId('plan-row').filter({ hasText: 'O2' });
  await expect(o2.locator('.wl-time')).toContainText('12 Oct');
  await expect(o2).not.toContainText('-10d');
  await expect(o2).not.toContainText('late');
  await expect(page.getByTestId('tally')).toHaveCount(0);
});

test('TD-04b an older task can be put on today with the button on its row', async ({ page }) => {
  await boot(page, { tables: { os_tasks: todoTasks() } });
  await openFold(page, 'older');
  await rowAction(page, 'O2', 'Plan O2 for today', page.getByTestId('sec-older'));
  await expect.poll(async () => (await db<{ title: string; planned_for: string }>(page, 'os_tasks')).find((t) => t.title === 'O2')?.planned_for).toBe(TODAY);
  await expect(nowTitle(page)).toHaveText('O2');
  expect(await titles(page, 'plan-list')).toEqual(['A', 'B']);
  // planned for today, it never reads late: Now shows its minutes
  await expect(page.locator('.nc-facts')).toHaveText('15 min');
  await expect(page.getByText('Moved to today: O2')).toBeVisible();
});

test('TD-05 one order for the day: the pick, what is due, then the timed rows at their times; only bad alerts need a look', async ({ page }) => {
  await boot(page, {
    tables: {
      os_tasks: [
        task('Old one', { due_date: day(-3) }),
        task('Old two', { due_date: day(-2) }),
        task('Call at 14', { due_date: TODAY, due_time: '14:00:00' }),
        task('Planned no time', { planned_for: TODAY }),
        task('Due not placed', { due_date: TODAY }),
      ],
      os_reminders: [reminderRow('Early', { repeat: 'daily', time_local: '08:15' }), reminderRow('Standup', { repeat: 'daily', time_local: '09:30' })],
      os_events: [event('Disk full', { severity: 'bad' }), event('Just warn', { severity: 'warn', kind: 'invoice' }), event('Just info', { severity: 'info' })],
    },
  });
  await expect(nowTitle(page)).toHaveText('Planned no time'); // his pick, not the 09:30 reminder
  // the 08:15 ring has passed and left; a timed task takes no place, so the third is an older task (R4Y03)
  expect(await titles(page, 'plan-list')).toEqual(['Standup', 'Due not placed', 'Old one', 'Call at 14']);
  const time = (t: string) => planRow(page, t).locator('.wl-time');
  await expect(time('Standup')).toHaveText('09:30');
  await expect(time('Call at 14')).toHaveText('14:00');
  await openFold(page, 'look');
  expect(await titles(page, 'sec-now')).toEqual(['Disk full']); // warn and info stay on Activity
  await expect(page.getByTestId('fold-older')).toContainText('1 older task');
});

test('TD-05b the band is a thin rule for the eye and a word for a screen reader (R4U22)', async ({ page }) => {
  await boot(page, { hash: '#/plan', tables: { os_tasks: [task('P1', { planned_for: TODAY }), task('P2', { planned_for: TODAY }), task('D1', { due_date: TODAY })] } });
  await expect(page.getByTestId('sheet-row')).toHaveCount(3);
  expect(await page.locator('[data-testid="sheet-row"] .band .sr').allTextContents()).toEqual(['Today', 'Today', 'Due today']);
  await expect(page.locator('[data-testid="sheet-row"] .band .w')).toHaveCount(0);
  expect(await page.locator('[data-testid="sheet-row"] .band').first().evaluate((e) => e.getBoundingClientRect().width)).toBeLessThanOrEqual(7);
});

test('TD-06 an overdue task also planned for today is on the plan once', async ({ page }) => {
  await boot(page, { tables: { os_tasks: [task('Both', { due_date: day(-4), planned_for: TODAY })] } });
  await expect(nowTitle(page)).toHaveText('Both');
  await expect(page.getByTestId('plan-row')).toHaveCount(0);
  await expect(page.getByTestId('fold-older')).toHaveCount(0);
});

test('TD-07 on /plan ticking a task done keeps it on the sheet struck, stamps it, and Undo or the tick brings it back', async ({ page }) => {
  await boot(page, { hash: '#/plan', tables: { os_tasks: todoTasks() } });
  await page.getByRole('checkbox', { name: 'Mark A done' }).click();
  const a = async () => (await db<{ title: string; status: string; completed_at: string | null }>(page, 'os_tasks')).find((t) => t.title === 'A')!;
  await expect.poll(async () => (await a()).status).toBe('done');
  expect((await a()).completed_at).not.toBeNull();
  // it stays in its place, struck, so the sheet shows progress (QA r2 P08)
  expect(await titles(page, 'sec-today')).toEqual(['A', 'B']);
  await expect(page.locator('[data-testid="sheet-row"][data-task-id]').filter({ hasText: 'A' }).first()).toHaveClass(/done/);
  await expect(page.getByText('Done: A', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await a()).status).toBe('open');
  await expect(page.getByRole('checkbox', { name: 'Mark A done' })).toBeVisible();
  // the tick on a done row reopens it
  await page.getByRole('checkbox', { name: 'Mark A done' }).click();
  await expect.poll(async () => (await a()).status).toBe('done');
  await page.getByRole('checkbox', { name: 'Reopen A' }).click();
  await expect.poll(async () => (await a()).status).toBe('open');
});

test('TD-07b the greeting counts what is left and what is done', async ({ page }) => {
  await boot(page, { tables: { os_tasks: todoTasks() } });
  await page.getByTestId('now-done').click();
  await expect(page.getByTestId('greeting')).toHaveText('Good morning. 2 to do, 1 done.');
});

test('TD-19 Tomorrow moves a task one day and it leaves Today', async ({ page }) => {
  await boot(page, { tables: { os_tasks: todoTasks() } });
  await expect(nowTitle(page)).toHaveText('A');
  await rowAction(page, 'A', 'Move A to tomorrow');
  await expect.poll(async () => (await db<{ title: string; planned_for: string }>(page, 'os_tasks')).find((t) => t.title === 'A')?.planned_for).toBe(day(1));
  await expect(nowTitle(page)).toHaveText('B');
  expect(await titles(page, 'plan-list')).toEqual(['O1', 'O2']); // the day tops back up to three
});

test('TD-20 a task planned for a later day is hidden on Today', async ({ page }) => {
  await boot(page, { tables: { os_tasks: [...todoTasks(), task('Z', { due_date: day(-14), planned_for: day(1) })] } });
  await openFold(page, 'older');
  await expect(page.getByTestId('plan-row').filter({ hasText: 'Z' })).toHaveCount(0);
  expect(await titles(page, 'sec-older')).toEqual(['O2', 'O3', 'O4']);
});

test('TD-31 seven planned tasks all show: the plan does not cap planned work', async ({ page }) => {
  await boot(page, { tables: { os_tasks: Array.from({ length: 7 }, (_, i) => task(`P${i}`, { planned_for: TODAY, sort_order: i })) } });
  await expect(nowTitle(page)).toHaveText('P0');
  await expect(page.getByTestId('plan-list').getByTestId('plan-row')).toHaveCount(4); // Next and three rows
  await expect(page.getByTestId('fold-rest')).toContainText('Rest of today 2');
  await expect(page.getByTestId('greeting')).toContainText('7 to do.');
});

test('TD-28 tapping a row, or the title in Now, opens the task sheet', async ({ page }) => {
  await boot(page, { tables: { os_tasks: todoTasks() } });
  await page.getByRole('button', { name: 'Open B' }).click();
  await expect(page.getByRole('dialog', { name: 'Task' })).toBeVisible();
  await expect(page.getByLabel('Title')).toHaveValue('B');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await nowTitle(page).click();
  await expect(page.getByLabel('Title')).toHaveValue('A');
});

test('TD-10 reminders: one that is due shows its time, a tick takes it off the plan and is saved, a passed ring and an inactive one are absent', async ({ page }) => {
  await boot(page, {
    tables: {
      os_reminders: [
        reminderRow('Daily nine', { repeat: 'daily', time_local: '09:00' }),
        reminderRow('Fired daily', { repeat: 'daily', time_local: '08:30', last_fired_at: iso(TODAY, '08:30') }),
        reminderRow('One off', { remind_at: iso(TODAY, '08:00'), last_fired_at: iso(TODAY, '08:00'), active: false }),
        reminderRow('Dead daily', { repeat: 'daily', time_local: '10:00', active: false }),
      ],
    },
  });
  const rows = page.locator('[data-testid="plan-row"][data-kind="reminder"]');
  await expect(rows).toHaveCount(1); // the plan is built from now: what has rung has gone by
  await expect(rows.filter({ hasText: 'Daily nine' }).locator('.wl-time')).toHaveText('09:00');
  await page.getByRole('checkbox', { name: 'Daily nine done' }).click();
  await expect(rows).toHaveCount(0);
  await expect.poll(async () => JSON.stringify((await db<{ key: string; value: unknown }>(page, 'os_settings')).find((x) => x.key === 'reminders_done')?.value ?? {})).toContain('r-Daily nine');
  await expect(page.getByText('Dead daily')).toHaveCount(0);
  await expect(page.getByTestId('plan-row').filter({ hasText: 'Fired daily' })).toHaveCount(0);
});

test('TD-10b a fired reminder banner offers Done and In 10 min; ringing leaves the row in place; the snooze copy is tagged', async ({ page }) => {
  await boot(page, { clock: '2026-10-22T08:59:50+05:30', tables: { os_reminders: [reminderRow('Stretch', { repeat: 'daily', time_local: '09:00' })] } });
  await expect(planRow(page, 'Stretch')).toBeVisible(); // loaded, so the ring is listening
  await page.clock.fastForward('00:00:15');
  const banner = page.getByTestId('banner-fired');
  await expect(banner).toContainText('Stretch');
  await expect(planRow(page, 'Stretch')).toBeVisible(); // ringing is not done
  await banner.getByRole('button', { name: 'In 10 min' }).click();
  await expect(banner).toHaveCount(0);
  await expect.poll(async () => (await db<{ title: string; repeat: string; remind_at: string | null }>(page, 'os_reminders')).filter((r) => r.title === 'Stretch' && r.repeat === 'none').length).toBe(1);
  const snooze = (await db<{ title: string; repeat: string; remind_at: string; snooze_of: string | null }>(page, 'os_reminders')).find((r) => r.repeat === 'none')!;
  expect(Math.round((new Date(snooze.remind_at).getTime() - new Date('2026-10-22T09:00:05+05:30').getTime()) / 60_000)).toBe(10);
  expect(snooze.snooze_of).toBe('r-Stretch');
});

test('TD-10c the banner Done takes the reminder off the plan', async ({ page }) => {
  await boot(page, { clock: '2026-10-22T08:59:50+05:30', tables: { os_reminders: [reminderRow('Stretch', { repeat: 'daily', time_local: '09:00' })] } });
  await expect(planRow(page, 'Stretch')).toBeVisible(); // loaded, so the ring is listening
  await page.clock.fastForward('00:00:15');
  await page.getByTestId('banner-fired').getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('banner-fired')).toHaveCount(0);
  await expect(planRow(page, 'Stretch')).toHaveCount(0);
});

test('TD-26 a tap on a reminder opens its sheet filled in', async ({ page }) => {
  await boot(page, { tables: { os_reminders: [reminderRow('Daily nine', { repeat: 'daily', time_local: '09:00' })] } });
  await planRow(page, 'Daily nine').getByRole('button').click();
  await expect(page.getByLabel('Title')).toHaveValue('Daily nine');
  await expect(page.getByLabel('Time (IST)', { exact: true })).toHaveValue('09:00');
});

test('TD-11b a daily reminder that rang while away gets no banner: it is already in the plan. A one-off still does (R4Y04)', async ({ page }) => {
  await boot(page, {
    tables: {
      os_settings: settings({ last_opened_at: iso(day(-1), '22:00') }) as never,
      os_reminders: [
        reminderRow('Morning look', { repeat: 'daily', time_local: '08:30', last_fired_at: iso(TODAY, '08:30') }),
        reminderRow('Plan tomorrow', { repeat: 'daily', time_local: '21:15', last_fired_at: iso(day(-1), '21:15') }),
        reminderRow('Early call', { last_fired_at: iso(TODAY, '06:30'), remind_at: iso(TODAY, '06:30'), active: false }),
      ],
    },
  });
  await expect(page.getByTestId('banner-missed')).toHaveCount(1);
  await expect(page.getByTestId('banner-missed')).toContainText('Early call');
});

test('TD-11 and TD-30 missed reminders show once and last_opened_at moves', async ({ page }) => {
  await boot(page, {
    tables: {
      os_settings: settings({ last_opened_at: iso(day(-1), '22:00') }) as never,
      os_reminders: [reminderRow('Early call', { last_fired_at: iso(TODAY, '06:30'), remind_at: iso(TODAY, '06:30'), active: false })],
    },
  });
  await expect(page.getByTestId('banner-missed')).toContainText('Earlier: Early call at 06:30'); // never "Missed" (QA r2 C04)
  await expect(page.getByTestId('banner-missed')).toContainText('06:30');
  await expect(page.getByTestId('banner-missed')).toContainText('Early call');
  await expect.poll(async () => (await db<{ key: string; value: string }>(page, 'os_settings')).find((s) => s.key === 'last_opened_at')?.value).toBeTruthy();
  const v = (await db<{ key: string; value: string }>(page, 'os_settings')).find((s) => s.key === 'last_opened_at')!.value;
  expect(Math.abs(new Date(v).getTime() - new Date(NOW).getTime())).toBeLessThan(120_000);
  await page.reload();
  await expect(page.getByTestId('greeting')).toBeVisible();
  await expect(page.getByTestId('banner-missed')).toHaveCount(0);
});

test('TD-13 the work numbers leave the screen: exceptions wait behind one fold, and each one links to its screen', async ({ page }) => {
  await boot(page, {
    tables: {
      os_campaign_snapshots: [
        snapRow({ campaign_id: 'E1', campaign_name: 'E1', sent_total: 150, bounces_total: 9, replies_total: 5 }),
        snapRow({ campaign_id: 'E2', campaign_name: 'E2', sent_total: 99, bounces_total: 50 }),
        snapRow({ campaign_id: 'E3', campaign_name: 'E3', status: 'paused', sent_total: 40 }),
      ],
      os_settings: settings({ balances: { millionverifier: { value: 50, limit: 10000, taken_at: null } } }) as never,
    },
  });
  await expect(page.getByTestId('camp-block')).toHaveCount(0);
  await expect(page.getByTestId('fold-look')).toContainText('2 things need a look');
  await openFold(page, 'look');
  expect(await titles(page, 'sec-now')).toEqual(['E1: 6.0% bounced', 'MillionVerifier is low']);
  await page.locator('[data-kind="flag"][data-flag="bounce"]').getByRole('link').click();
  await expect(page).toHaveURL(/#\/campaigns/);
});

test('TD-22 no bounce row at exactly 3 percent', async ({ page }) => {
  await boot(page, { tables: { os_tasks: [task('Alpha', { planned_for: TODAY })], os_campaign_snapshots: [snapRow({ campaign_name: 'Z', sent_total: 200, bounces_total: 6 }), snapRow({ campaign_name: 'Y', sent_total: 99, bounces_total: 50 })] } });
  await expect(nowTitle(page)).toHaveText('Alpha');
  await expect(page.getByTestId('fold-look')).toHaveCount(0);
  await expect(page.locator('[data-kind="flag"]')).toHaveCount(0);
});

test('TD-21 a Now row when no email campaign runs', async ({ page }) => {
  const rows = [
    snapRow({ campaign_id: 'P', status: 'paused', sent_total: 10, taken_at: iso(day(-5), '09:00') }),
    snapRow({ campaign_id: 'P', status: 'paused', sent_total: 20, taken_at: iso(day(-4), '09:00') }),
    snapRow({ campaign_id: 'P', status: 'paused', sent_total: 20, taken_at: iso(day(-3), '09:00') }),
  ];
  await boot(page, { tables: { os_campaign_snapshots: rows } });
  await openFold(page, 'look');
  const flag = page.locator('[data-kind="flag"][data-flag="no-email"]');
  await expect(flag).toContainText('No email campaign running');
  await expect(flag).toContainText('Last send 18 Oct.');
});

test('R3C01 while the lists load the greeting does not call the day empty', async ({ page }) => {
  await boot(page, { tables: { os_tasks: todoTasks() }, latency: 1200 });
  await expect(page.getByTestId('greeting')).toHaveText('Good morning. Opening your day.');
  await expect(page.getByTestId('greeting')).not.toContainText('Nothing on');
  await expect(page.getByTestId('greeting')).toContainText('to do', { timeout: 8000 });
});

test('TD-17 the date rolls over at midnight IST and last_opened_at is written', async ({ page }) => {
  await boot(page, { clock: '2026-10-22T23:59:00+05:30' });
  await expect(page.getByTestId('today-date')).toHaveText('Thu 22 Oct');
  await page.clock.fastForward('02:00');
  await expect(page.getByTestId('today-date')).toHaveText('Fri 23 Oct');
  await expect.poll(async () => {
    const v = (await db<{ key: string; value: string }>(page, 'os_settings')).find((s) => s.key === 'last_opened_at')?.value;
    return v ? new Date(v).getTime() >= new Date('2026-10-23T00:00:00+05:30').getTime() : false;
  }).toBe(true);
});

test('TD-18 the date is IST even when the device is in Los Angeles', async ({ page }) => {
  await boot(page, { clock: '2026-10-21T23:00:00-07:00' });
  await expect(page.getByTestId('today-date')).toHaveText('Thu 22 Oct');
});

test('TD-19b the stamp names the sheet and carries no clock', async ({ page }) => {
  await boot(page);
  await expect(page.getByTestId('stamp')).toHaveAttribute('aria-label', 'Morning shift');
  await expect(page.getByTestId('stamp')).not.toContainText('09:00');
});

test('TD-23 coming back to the app pulls a task inserted elsewhere', async ({ page }) => {
  await boot(page, { tables: { os_tasks: [] } });
  await external(page, 'os_tasks', task('From terminal', { planned_for: TODAY }));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(nowTitle(page)).toHaveText('From terminal');
});

test('TD-24 habits scheduled today sit in the one plan, at their time or in the next gap; other days stay away', async ({ page }) => {
  await boot(page, {
    tables: {
      os_habits: [habitRow('M', { days: [1, 2, 3, 4, 5], time_local: '13:00', created_at: iso(day(-20)) }), habitRow('S', { days: [6] }), habitRow('Read')],
      os_habit_logs: [log('M', day(-1)), log('M', day(-2))],
      os_reminders: [reminderRow('Pills', { area: 'personal', repeat: 'daily', time_local: '12:00' })],
      os_tasks: [task('Call mum', { area: 'personal', planned_for: TODAY })],
    },
  });
  await expect(nowTitle(page)).toHaveText('Call mum');
  expect(await titles(page, 'plan-list')).toEqual(['Pills', 'M', 'Read']); // a habit with no time comes last
  await expect(page.locator('[data-testid="plan-row"][data-kind="habit"]').filter({ has: page.getByText('M', { exact: true }) }).locator('.wl-t')).toHaveText('13:00');
  await expect(page.getByRole('heading', { name: 'Habits' })).toHaveCount(0); // no separate block
});

test('TD-25 ticking a habit writes the log and it leaves the plan; a lost reply still counts as saved (D4)', async ({ page }) => {
  await boot(page, { tables: { os_tasks: [task('Alpha', { planned_for: TODAY })], os_habits: [habitRow('M')] } });
  await expect(page.getByRole('checkbox', { name: 'M done today' })).toBeVisible();
  await page.evaluate(() => (window as unknown as { __mock: { setFail(f: object): void } }).__mock.setFail({ lost: 1 }));
  await page.getByRole('checkbox', { name: 'M done today' }).click();
  await expect.poll(async () => (await db(page, 'os_habit_logs')).length).toBe(1);
  await expect(page.getByRole('checkbox', { name: 'M done today' })).toHaveCount(0);
  await expect(page.getByText('Not saved', { exact: false })).toHaveCount(0);
});

test('TD-25b a habit in Now is ticked with Done', async ({ page }) => {
  await boot(page, { tables: { os_habits: [habitRow('M', { time_local: '09:00' })] } });
  await expect(page.getByTestId('now-card')).toHaveAttribute('data-kind', 'habit');
  await page.getByTestId('now-done').click();
  await expect.poll(async () => (await db(page, 'os_habit_logs')).length).toBe(1);
  await expect(page.getByTestId('now-card')).toHaveAttribute('data-kind', 'none');
});

test('TD-27 at most two unread bad alerts from either area; a tap marks read and opens the url; Got it marks read', async ({ page }) => {
  await page.context().route('https://github.com/**', (r) => r.fulfill({ body: 'ok' }));
  const evs = Array.from({ length: 4 }, (_, i) => event(`Ev${i}`, { severity: 'bad', occurred_at: iso(TODAY, `0${i + 4}:00`), url: i === 3 ? 'https://github.com/x' : null }));
  await boot(page, { tables: { os_events: [...evs, event('Quiet', { severity: 'info' }), event('Home alert', { severity: 'bad', area: 'personal' })] } });
  await openFold(page, 'look');
  const alerts = page.locator('[data-testid="sheet-row"][data-kind="alert"]');
  await expect(alerts).toHaveCount(2);
  expect(await titles(page, 'sec-now')).toEqual(['Home alert', 'Ev3']); // newest first, both areas
  await expect(page.getByText('Quiet')).toHaveCount(0);
  const popup = page.waitForEvent('popup');
  await alerts.filter({ hasText: 'Ev3' }).getByRole('button').first().click();
  expect((await popup).url()).toContain('github.com/x');
  await expect.poll(async () => (await db<{ title: string; read_at: string | null }>(page, 'os_events')).find((e) => e.title === 'Ev3')?.read_at).toBeTruthy();
  await expect(alerts.filter({ hasText: 'Ev2' })).toBeVisible(); // the next one moves up
  await alerts.filter({ hasText: 'Ev2' }).getByRole('button', { name: 'Clear Ev2 from Today' }).click();
  await expect.poll(async () => (await db<{ title: string; read_at: string | null }>(page, 'os_events')).find((e) => e.title === 'Ev2')?.read_at).toBeTruthy();
  await expect(alerts.filter({ hasText: 'Ev1' })).toBeVisible();
});

test('TD-32 on /plan Claude rides on the row: working, then a result that stays until Got it; an old request reads no word and can be stopped', async ({ page }) => {
  const t = task('Draft quote', { planned_for: TODAY });
  await boot(page, {
    hash: '#/plan',
    tables: {
      os_tasks: [t],
      os_claude_requests: [
        req('c1', 'Draft quote', 'sent', { task_id: t.id, session_url: 'https://claude.ai/code/session_x' }),
        req('c2', 'Old audit', 'sent', { sent_at: new Date(new Date(NOW).getTime() - 3 * 3600_000).toISOString() }),
        req('c3', 'Seen one', 'done', { seen_at: new Date(NOW).toISOString() }),
      ],
    },
  });
  const line = page.getByTestId('sheet-row').filter({ hasText: 'Draft quote' }).getByTestId('claude-line');
  await expect(line).toContainText('Claude: working since');
  await expect(line.getByRole('button', { name: 'Open the Claude session' })).toBeVisible();
  const old = page.getByTestId('claude-row').filter({ hasText: 'Old audit' });
  await expect(old).toContainText('Claude: no word since Thu 06:00. Open the session to check.'); // the day, not a question (QA r2 C11, P06)
  await expect(old.getByRole('button', { name: 'Stop waiting for Old audit' })).toBeVisible();
  await expect(page.getByText('Seen one')).toHaveCount(0);
  // the routine writes a result back
  await external(page, 'os_claude_requests', req('c4', 'Draft quote', 'done', { task_id: null, title: 'Summary', result: 'Draft is in Gmail.' }), true);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const done = page.getByTestId('claude-row').filter({ hasText: 'Summary' });
  await expect(done).toContainText('Claude finished: Draft is in Gmail.');
  await done.getByRole('button', { name: 'Clear Summary from Today' }).click();
  await expect(done).toHaveCount(0);
  expect((await db<{ id: string; seen_at: string | null }>(page, 'os_claude_requests')).find((r) => r.id === 'c4')?.seen_at).toBeTruthy();
});

test('TD-32b on the war room a task with Claude leaves the plan and waits behind the fold, with its line and its Got it', async ({ page }) => {
  const t = task('Draft quote', { planned_for: TODAY });
  await boot(page, {
    tables: {
      os_tasks: [t, task('Alpha', { planned_for: TODAY })],
      os_claude_requests: [
        req('c1', 'Draft quote', 'sent', { task_id: t.id, session_url: 'https://claude.ai/code/session_x' }),
        req('c2', 'Old audit', 'sent', { sent_at: new Date(new Date(NOW).getTime() - 3 * 3600_000).toISOString() }),
        req('c3', 'Seen one', 'done', { seen_at: new Date(NOW).toISOString() }),
        req('c4', 'Summary', 'done', { result: 'Draft is in Gmail.' }),
      ],
    },
  });
  await expect(nowTitle(page)).toHaveText('Alpha'); // never the task Claude holds
  await expect(page.getByTestId('plan-row').filter({ hasText: 'Draft quote' })).toHaveCount(0);
  await expect(page.getByTestId('fold-claude')).toContainText('3 with Claude');
  await openFold(page, 'claude');
  const rows = page.getByTestId('claude-row');
  const line = rows.filter({ hasText: 'Draft quote' }).getByTestId('claude-line');
  await expect(line).toContainText('Claude: working since');
  await expect(line.getByRole('button', { name: 'Open the Claude session' })).toBeVisible();
  await expect(rows.filter({ hasText: 'Old audit' }).getByRole('button', { name: 'Stop waiting for Old audit' })).toBeVisible();
  await expect(page.getByText('Seen one')).toHaveCount(0);
  await rows.filter({ hasText: 'Summary' }).getByRole('button', { name: 'Clear Summary from Today' }).click();
  await expect(rows.filter({ hasText: 'Summary' })).toHaveCount(0);
  expect((await db<{ id: string; seen_at: string | null }>(page, 'os_claude_requests')).find((r) => r.id === 'c4')?.seen_at).toBeTruthy();
});

test('FU-09 the tick on a follow-up row is Followed up and closes the loop', async ({ page }) => {
  await boot(page, { hash: '#/plan', tables: { os_tasks: [task('Follow up with Sam', { project: 'sales', source: 'master_sheet', source_ref: 'k1', due_date: day(-1), planned_for: TODAY })] } });
  await page.getByRole('checkbox', { name: 'Followed up Follow up with Sam' }).click();
  // it stays on the sheet, struck, and the tick reopens it (QA r2 P08)
  await expect(page.getByRole('checkbox', { name: 'Reopen Follow up with Sam' })).toBeVisible();
  await expect(page.getByText('Done: Follow up with Sam')).toBeVisible();
  const t = (await db<{ status: string; notes: string }>(page, 'os_tasks'))[0];
  expect(t.status).toBe('done');
  expect(t.notes).toContain(TODAY);
});

test('TD-35 a work exception can be handed to Claude with a prefilled brief, or hidden for today', async ({ page }) => {
  await boot(page, { tables: { os_campaign_snapshots: [snapRow({ campaign_id: 'E1', campaign_name: 'HVAC US wave 4', sent_total: 857, bounces_total: 34 })] } });
  await openFold(page, 'look');
  const flag = page.locator('[data-kind="flag"][data-flag="bounce"]');
  await expect(flag).toContainText('HVAC US wave 4: 4.0% bounced');
  await flag.getByRole('button', { name: 'Ask Claude about HVAC US wave 4: 4.0% bounced' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Brief')).toHaveValue(/Do not pause anything[\s\S]*HVAC US wave 4: 4.0% bounced/);
  await page.keyboard.press('Escape');
  await flag.getByRole('button', { name: /^Hide .* for today$/ }).click();
  await expect(flag).toHaveCount(0);
  await expect.poll(async () => JSON.stringify((await db<{ key: string; value: unknown }>(page, 'os_settings')).find((x) => x.key === 'flags_seen')?.value ?? {})).toContain(TODAY);
  await page.reload();
  await expect(page.getByTestId('now-card')).toBeVisible();
  await expect(page.getByTestId('fold-look')).toHaveCount(0);
});

test('TD-36 the line he wrote for today shows read only on /plan', async ({ page }) => {
  await boot(page, { hash: '#/plan', tables: { os_tasks: [task('A', { planned_for: TODAY })], os_days: [{ day: TODAY, plan: 'Ship the proposal', review: null, top_task_ids: [], mood: null }] } });
  await expect(page.getByTestId('situation-ro')).toHaveText('Ship the proposal');
  await expect(page.getByLabel('What is today about')).toHaveCount(0);
});

test('TD-37 a Claude hand-off by copy reads as his, and ticking the task closes the request', async ({ page }) => {
  const t = task('Draft quote', { planned_for: TODAY });
  await boot(page, { hash: '#/plan', tables: { os_tasks: [t], os_claude_requests: [claudeRow('Draft quote', { task_id: t.id, handoff: 'copy', session_url: null })] } });
  await expect(page.getByTestId('claude-line')).toContainText('With Claude Code since');
  await expect(page.getByTestId('claude-line')).toContainText('Tick the task when done.');
  await page.getByRole('checkbox', { name: 'Mark Draft quote done' }).click();
  await expect.poll(async () => (await db<{ title: string; status: string }>(page, 'os_claude_requests')).find((r) => r.title === 'Draft quote')?.status).toBe('done');
});
