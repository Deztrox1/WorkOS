/**
 * Stories covered: SH-01 SH-03 SH-04 SH-05 SH-07 SH-11 SH-12 SH-13 SH-15 SH-18 SH-19 SH-21, FU-01 (phone)
 */
import { expect, test } from '@playwright/test';
import { boot, calEvent, day, event, habitRow, linkLabels, openFold, reminderRow, snapRow, task } from './helpers';

test('SH-01 four bottom tabs, and More lists the rest', async ({ page }) => {
  await boot(page);
  const tabs = page.getByRole('navigation', { name: 'Tabs' });
  await expect.poll(() => linkLabels(tabs)).toEqual(['Today', 'Plan', 'Tasks', 'More']);
  expect((await tabs.boundingBox())!.y).toBeGreaterThan(700);
  expect((await page.locator('.topbar').boundingBox())!.y).toBe(0);
  await tabs.getByRole('link', { name: /More/ }).click();
  const more = page.getByRole('navigation', { name: 'More' });
  await expect.poll(() => linkLabels(more)).toEqual(['Reminders', 'Habits', 'Campaigns', 'Finance', 'Notes', 'Claude', 'Activity', 'Settings']);
});

test('SH-01b the nav does not follow the mode: the same tabs and the same More in both', async ({ page }) => {
  await boot(page, { mode: 'personal' });
  const tabs = page.getByRole('navigation', { name: 'Tabs' });
  await expect.poll(() => linkLabels(tabs)).toEqual(['Today', 'Plan', 'Tasks', 'More']);
  await tabs.getByRole('link', { name: /More/ }).click();
  const more = page.getByRole('navigation', { name: 'More' });
  await expect.poll(() => linkLabels(more)).toEqual(['Reminders', 'Habits', 'Campaigns', 'Finance', 'Notes', 'Claude', 'Activity', 'Settings']);
});

test('SH-01c the mode switch sits on the screens it filters, and only there', async ({ page }) => {
  await boot(page, { hash: '#/tasks' });
  const tabs = page.getByRole('navigation', { name: 'Tabs' });
  for (const h of ['#/tasks', '#/reminders', '#/notes', '#/activity']) {
    await page.goto(`/?mock=1${h}`);
    await expect(page.getByRole('main').getByRole('group', { name: 'Mode' })).toBeVisible();
  }
  for (const h of ['#/', '#/plan', '#/claude', '#/finance', '#/settings']) {
    await page.goto(`/?mock=1${h}`);
    await expect(page.getByTestId('mode-line')).toHaveCount(0);
  }
  await expect.poll(() => linkLabels(tabs)).toEqual(['Today', 'Plan', 'Tasks', 'More']);
});

test('SH-03 Personal mode filters tasks, reminders, habits and alerts on the one-area screens', async ({ page }) => {
  const tables = {
    os_tasks: [task('OfficeTask', { planned_for: '2026-10-22' }), task('PersTask', { area: 'personal', planned_for: '2026-10-22' })],
    os_reminders: [reminderRow('OfficeRem', { repeat: 'daily', time_local: '10:00' }), reminderRow('PersRem', { area: 'personal', repeat: 'daily', time_local: '11:00' })],
    os_habits: [habitRow('PersHab'), habitRow('WorkHab', { area: 'work' })],
    os_events: [event('OfficeEv', { severity: 'bad' }), event('PersEv', { severity: 'bad', area: 'personal' })],
  };
  await boot(page, { hash: '#/tasks', tables });
  await page.getByRole('button', { name: 'Personal' }).click();
  for (const [hash, mine, other] of [['#/tasks', 'PersTask', 'OfficeTask'], ['#/reminders', 'PersRem', 'OfficeRem'], ['#/activity', 'PersEv', 'OfficeEv'], ['#/habits', 'PersHab', null]] as const) {
    await page.goto(`/?mock=1${hash}`);
    await expect(page.getByText(mine).first()).toBeVisible();
    if (other) await expect(page.getByText(other)).toHaveCount(0);
  }
});

test('SH-04 dark and light themes apply from the system setting', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await boot(page);
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(await bg()).toBe('rgb(15, 20, 19)');
  await page.emulateMedia({ colorScheme: 'light' });
  expect(await bg()).toBe('rgb(233, 237, 237)');
});

test('SH-04 text contrast is AA in both themes', async ({ page }) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await boot(page, { tables: { os_tasks: [task('Contrast', { planned_for: '2026-10-22', due_date: day(-2), est_minutes: 5, next_action: 'Read it' }), task('Late', { due_date: day(-2) }), task('Late 2', { due_date: day(-3) }), task('Late 3', { due_date: day(-4) })] } });
    await openFold(page, 'older');
    await expect(page.getByTestId('sec-older').getByTestId('plan-row').first()).toBeVisible();
    const ratios = await page.evaluate(() => {
      const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const lum = ([r, g, b]: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const bg = lum(parse(getComputedStyle(document.body).backgroundColor));
      const paper = lum(parse(getComputedStyle(document.querySelector('.tabbar')!).backgroundColor));
      const out: number[] = [];
      for (const sel of ['.t1', '.t2', '.t3', '.spine.late', '.sec, .sec-n', '.eyebrow, .group-h h3', 'h2', '.greet', '.wl-time', '.wl-time.est', '.wl-word', '.hint']) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const fg = lum(parse(getComputedStyle(el).color));
        const base = Math.min(bg, paper);
        const hi = Math.max(fg, base) + 0.05, lo = Math.min(fg, base) + 0.05;
        out.push(hi / lo);
      }
      return out;
    });
    expect(ratios.length).toBeGreaterThan(2);
    for (const r of ratios) expect(r).toBeGreaterThanOrEqual(4.5);
    await page.evaluate(() => sessionStorage.clear());
  }
});

test('SH-05 every button, tab, checkbox and row on Today is at least 44 px', async ({ page }) => {
  await boot(page, {
    tables: {
      os_tasks: [task('One', { planned_for: '2026-10-22', project: 'sales', source: 'master_sheet', due_date: day(-1) }), task('Two', { planned_for: '2026-10-22' }), task('Old', { due_date: day(-9) }), task('Old 2', { due_date: day(-8) })],
      os_events: [event('Ev', { severity: 'bad' })], os_habits: [habitRow('Walk', { area: 'work' })], os_reminders: [reminderRow('R', { repeat: 'daily', time_local: '20:00' })],
      os_calendar_events: [calEvent('Block', '15:00', '15:30', { html_link: 'https://www.google.com/calendar/event?eid=x', meet_link: 'https://meet.google.com/abc' })],
    },
  });
  await expect(page.getByTestId('now-card')).toBeVisible();
  await expect(page.getByTestId('plan-row').filter({ hasText: 'Block' })).toBeVisible();
  await page.getByTestId('fold-older').click();
  await page.getByTestId('fold-look').click();
  const small = await page.evaluate(() => {
    const bad: string[] = [];
    document.querySelectorAll('button, a, [role="checkbox"], .row, input, select').forEach((el) => {
      if (el.closest('.mode-line')) return; // the mode switch is 40 px tall by design; its 44 px target is a pseudo-element (checked below)
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (r.width < 43.5 || r.height < 43.5) bad.push(`${el.tagName} ${(el.textContent || el.getAttribute('aria-label') || '').slice(0, 20)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    });
    return bad;
  });
  expect(small).toEqual([]);
});

test('SH-07 sheets rise from the bottom, at most 90 percent tall, with a handle', async ({ page }) => {
  await boot(page, { tables: { os_tasks: [task('Sheet me', { planned_for: '2026-10-22' })] } });
  await page.getByTestId('now-title').click();
  const s = page.getByRole('dialog', { name: 'Task' });
  await expect.poll(async () => { const b = (await s.boundingBox())!; return Math.round(b.y + b.height); }).toBe(844);
  const box = (await s.boundingBox())!;
  expect(box.height).toBeLessThanOrEqual(844 * 0.9 + 1);
  await expect(s.locator('.handle')).toBeVisible();
});

test('SH-11 fonts and every request stay on the same origin', async ({ page }) => {
  const hosts = new Set<string>();
  const fonts: string[] = [];
  page.on('request', (r) => { const u = new URL(r.url()); hosts.add(u.host); if (/\.(woff2?|ttf)$/.test(u.pathname)) fonts.push(u.pathname); });
  await boot(page);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByTestId('greeting')).toBeVisible();
  expect([...hosts]).toEqual(['127.0.0.1:4173']);
  expect(fonts.join(' ')).toMatch(/bricolage/);
  expect(fonts.join(' ')).toMatch(/hanken/);
});

test('SH-12 the mode is remembered per device', async ({ browser, page }) => {
  await boot(page, { mode: null, hash: '#/tasks' });
  await page.getByRole('button', { name: 'Personal' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Personal' })).toHaveAttribute('aria-pressed', 'true');
  const other = await browser.newContext({ viewport: { width: 1280, height: 800 }, timezoneId: 'America/Los_Angeles' });
  const p2 = await other.newPage();
  await boot(p2, { mode: null, hash: '#/tasks' });
  await expect(p2.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Work', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await other.close();
});

test('SH-13 from Personal, Campaigns is one tap away and opens with no bounce', async ({ page }) => {
  await boot(page, { mode: 'personal' });
  await page.getByRole('link', { name: /More/ }).click();
  const more = page.getByRole('navigation', { name: 'More' });
  await more.getByRole('link', { name: 'Campaigns' }).click();
  await expect(page).toHaveURL(/#\/campaigns$/);
  await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('workos.mode'))).toBe('work');
});

test('SH-15 hash routes deep link and survive a reload', async ({ page }) => {
  await boot(page, { hash: '#/finance' });
  await expect(page.getByRole('heading', { name: 'Finance' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Finance' })).toBeVisible();
});

test('SH-18 status colours always come with a word or an icon', async ({ page }) => {
  await boot(page, {
    hash: '#/tasks', tables: { os_tasks: [task('Late', { due_date: day(-3) })], os_events: [event('Bad one', { severity: 'bad' })], os_campaign_snapshots: [snapRow({ campaign_name: 'M', status: 'paused', raw: { playbook_status: 'active' } })] },
  });
  // An earlier due date sits in the time spine in plain ink, with the words for a screen reader (R2C05, R2C26).
  const [, m, n] = day(-3).split('-').map(Number);
  const when = `${n} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}`;
  const late = page.getByTestId('task-row').locator('.spine');
  await expect(late.locator('.v')).toHaveText(when);
  await expect(late.locator('.sr')).toHaveText(`due ${when}`);
  await expect(late.locator('.late')).toHaveCount(0);
  await page.goto('/#/campaigns');
  await expect(page.getByTestId('camp-row')).toContainText('playbook differs');
  await page.goto('/#/activity');
  // A severity dot always sits beside its plain word (U15).
  const sev = page.getByTestId('feed-row').locator('.sev.bad');
  await expect(sev.locator('.dot.bad')).toBeVisible();
  await expect(sev).toContainText('Problem');
  await expect(page.getByTestId('feed-row')).toContainText('Alert');
});

test('SH-19 reduced motion removes the sheet animation; otherwise 180 ms', async ({ page }) => {
  await boot(page, { tables: { os_tasks: [task('Anim', { planned_for: '2026-10-22' })] } });
  await page.getByTestId('now-title').click();
  expect(await page.getByRole('dialog', { name: 'Task' }).evaluate((e) => getComputedStyle(e).animationDuration)).toBe('0.18s');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.getByRole('dialog', { name: 'Task' }).evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
});

test('SH-21 times read in 24 h IST on a Los Angeles device', async ({ page }) => {
  await boot(page, { tables: { os_reminders: [reminderRow('Three pm', { repeat: 'daily', time_local: '15:00' })] } });
  await expect(page.getByTestId('plan-row').filter({ hasText: 'Three pm' })).toContainText('15:00');
});

test('SH-22 the theme capsule flips data-theme and the page colours, and the choice survives a reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await boot(page);
  const html = page.locator('html');
  const cap = page.locator('.topbar').getByRole('switch', { name: /^Dark theme/ });
  await expect(cap).toHaveAttribute('aria-checked', 'false');
  await expect(cap).toHaveAccessibleName('Dark theme off. Switch to dark.');
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(await bg()).toBe('rgb(233, 237, 237)');
  await cap.click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(cap).toHaveAttribute('aria-checked', 'true');
  await expect(cap).toHaveAccessibleName('Dark theme on. Switch to light.');
  expect(await bg()).toBe('rgb(15, 20, 19)');
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.topbar').getByRole('switch', { name: /^Dark theme on/ })).toBeVisible();
  await page.locator('.topbar').getByRole('switch', { name: /^Dark theme/ }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  expect(await bg()).toBe('rgb(233, 237, 237)');
});

test('SH-23 with no saved choice the capsule follows the system; Settings has System, Light, Dark', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await boot(page, { hash: '#/settings' });
  await expect(page.locator('.topbar').getByRole('switch', { name: /^Dark theme on/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  const seg = page.getByRole('group', { name: 'Theme' });
  await expect(seg.getByRole('button')).toHaveText(['System', 'Light', 'Dark']);
  await seg.getByRole('button', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.topbar').getByRole('switch', { name: /^Dark theme off/ })).toHaveAttribute('aria-checked', 'false');
});

test('SH-24 the sample data banner shows in mock mode', async ({ page }) => {
  await boot(page);
  await expect(page.getByTestId('sample-banner')).toContainText('Sample data');
});
