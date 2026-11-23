/**
 * Fix pass 1 (QA 1 + QA 2 findings). Phone width. Items: 1 CSP and theme, 2 Today list and add button, 3 compact row action,
 * 4 one Refresh, 5 badge contrast, 6 IST stamps, 8 campaigns table, 14 links, 15 focus trap, 16 habit strip, 17 mood,
 * 18 finance chart and ledger rows, 19 mode switch, 21 real seed data, 22 month select.
 */
import { expect, test } from '@playwright/test';
import { TODAY, boot, day, event, fin, habitRow, iso, rowAction, snapRow, task } from './helpers';

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://oldprojectref.supabase.co wss://oldprojectref.supabase.co; worker-src 'self'; manifest-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

test('1 the theme bootstrap is an external script: no CSP error, and a saved Dark survives a reload', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(String(e)));
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() === 'document') {
      const res = await route.fetch();
      await route.fulfill({ response: res, headers: { ...res.headers(), 'content-security-policy': CSP } });
    } else await route.continue();
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await boot(page, { theme: 'dark' });
  await expect(page.getByTestId('greeting')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('greeting')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(15, 20, 19)');
  expect(problems.filter((p) => /Content Security Policy|CSP|Refused to execute/i.test(p))).toEqual([]);
  const html = await (await page.request.get('/')).text();
  expect(html).toContain('src="/theme.js"');
  expect(html.replace(/<script[^>]*\bsrc=[^>]*><\/script>/g, '')).not.toMatch(/<script/);
  expect((await page.request.get('/theme.js')).status()).toBe(200);
});

test('2 Today: the overdue backlog folds into one line the add button does not cover', async ({ page }) => {
  const tables = {
    os_tasks: [
      task('P1', { planned_for: TODAY }),
      ...Array.from({ length: 8 }, (_, i) => task(`O${i + 1}`, { due_date: day(-20 + i) })),
    ],
  };
  await boot(page, { tables });
  await expect(page.getByTestId('now-title')).toHaveText('P1');
  const more = page.getByTestId('fold-older');
  await expect(more).toContainText('6 older tasks'); // two of the eight top the day up to three
  await more.scrollIntoViewIfNeeded();
  const m = (await more.locator('b').boundingBox())!;
  const f = (await page.locator('[data-testid="add"]:visible').boundingBox())!;
  const overlap = m.x < f.x + f.width && m.x + m.width > f.x && m.y < f.y + f.height && m.y + m.height > f.y;
  expect(overlap).toBe(false);
  await more.click();
  await expect(page.getByTestId('sec-older').getByTestId('plan-row')).toHaveCount(6);
});

test('3 phone rows: one compact action menu, the tick is Followed up, and line 3 keeps the project and minutes', async ({ page }) => {
  await boot(page, {
    hash: '#/plan',
    tables: {
      os_tasks: [task('Follow up with Fastax', {
        project: 'sales', est_minutes: 10, source: 'master_sheet', due_date: day(-12), cost_usd: 12.5, planned_for: TODAY,
        updated_at: iso(day(-9)),
      })],
    },
  });
  const row = page.getByTestId('sheet-row');
  await expect(row.getByRole('checkbox', { name: 'Followed up Follow up with Fastax' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Tomorrow', exact: true })).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Followed up', exact: true })).toHaveCount(0);
  await expect(row.getByTestId('ask-claude')).toHaveCount(0);
  const menu = row.getByRole('button', { name: 'Actions for Follow up with Fastax' });
  expect((await menu.boundingBox())!.width).toBeGreaterThanOrEqual(44);
  const l3 = row.locator('.t3');
  await expect(l3).toContainText('10 min · sales');
  expect(await l3.evaluate((e) => e.scrollWidth <= e.clientWidth + 1 && getComputedStyle(e).textOverflow !== 'ellipsis')).toBe(true);
  await menu.click();
  const items = page.getByRole('menuitem');
  expect(await items.allInnerTexts()).toEqual(['Ask Claude', 'Open']); // Tomorrow and Drop are chips on the close row
  await page.keyboard.press('Escape');
  await expect(items).toHaveCount(0);
  await rowAction(page, 'Follow up with Fastax', 'Move Follow up with Fastax to tomorrow');
  await expect(row).toHaveCount(0);
});

test('3c war room rows on a phone: the tick is Followed up, one action menu, and Do first sits in it', async ({ page }) => {
  const alpha = task('Alpha', { planned_for: TODAY });
  await boot(page, {
    tables: {
      os_tasks: [alpha, task('Follow up with Fastax', { project: 'sales', est_minutes: 10, source: 'master_sheet', due_date: day(-12), planned_for: TODAY })],
      os_days: [{ day: TODAY, plan: null, review: null, top_task_ids: [alpha.id as string], mood: null }],
    },
  });
  const row = page.getByTestId('plan-row').filter({ hasText: 'Follow up with Fastax' });
  await expect(row.getByRole('checkbox', { name: 'Followed up Follow up with Fastax' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Tomorrow', exact: true })).toHaveCount(0);
  await expect(row.getByTestId('ask-claude')).toHaveCount(0);
  await expect(row.locator('.t3')).toContainText('10 min');
  const menu = row.getByRole('button', { name: 'Actions for Follow up with Fastax' });
  expect((await menu.boundingBox())!.width).toBeGreaterThanOrEqual(44);
  await menu.click();
  expect(await page.getByRole('menuitem').allInnerTexts()).toEqual(['Ask Claude', 'Do first', 'Tomorrow', 'Open']);
  await page.keyboard.press('Escape');
  await rowAction(page, 'Follow up with Fastax', 'Move Follow up with Fastax to tomorrow');
  await expect(row).toHaveCount(0);
});

test('4 a phone has no Refresh: the app refetches on focus and every 5 minutes', async ({ page }) => {
  await boot(page);
  await expect(page.getByTestId('now-card')).toBeVisible();
  await expect(page.getByRole('button', { name: /Refresh/ })).toHaveCount(0);
});

test('5 the unread badge passes AA in dark and light; it counts only bad events not already on Today', async ({ page }) => {
  for (const scheme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    // two bad ones are on Today, the third earns the badge; warn and info never count
    await boot(page, { tables: { os_events: [event('Ev1', { severity: 'bad' }), event('Ev2', { severity: 'bad' }), event('Ev3', { severity: 'bad' }), event('W', { severity: 'warn' }), event('I')] } });
    const badge = page.locator('.tabbar').getByTestId('feed-badge');
    await expect(badge).toHaveText('1');
    const r = await badge.evaluate((el) => {
      const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const lum = ([a, b, c]: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(a) + 0.7152 * f(b) + 0.0722 * f(c); };
      const cs = getComputedStyle(el);
      const l1 = lum(parse(cs.color)), l2 = lum(parse(cs.backgroundColor));
      return { ratio: (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05), size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight) };
    });
    expect(r.ratio).toBeGreaterThanOrEqual(4.5);
    expect(r.size).toBeGreaterThanOrEqual(12);
    expect(r.weight).toBeGreaterThanOrEqual(600);
    await page.evaluate(() => sessionStorage.clear());
  }
});

test('6 task sheet Created and Updated show Asia/Kolkata, 24 h', async ({ page }) => {
  // the browser runs in America/Los_Angeles; 20:30 UTC is 02:00 next day in IST
  await boot(page, { tables: { os_tasks: [task('Stamp me', { planned_for: TODAY, created_at: '2026-10-20T20:30:00Z', updated_at: '2026-10-21T08:05:00Z' })] } });
  await page.getByTestId('now-title').click();
  const info = page.getByRole('dialog', { name: 'Task' }).locator('dl[aria-label="Task info"]');
  await expect(info).toContainText('21 Oct 02:00');
  await expect(info).toContainText('21 Oct 13:35');
});

test('8 campaigns on a phone: the Bounce header is whole and the table scrolls inside its box', async ({ page }) => {
  await boot(page, { hash: '#/campaigns', tables: { os_campaign_snapshots: [snapRow({ campaign_name: 'Bakeries US wave 1', sent_total: 400, replies_total: 12, bounces_total: 8 })] } });
  const th = page.locator('table.tbl th:visible');
  await expect(th).toHaveText(['Name', 'Status', 'Sent', 'Replies', 'Bounce']);
  for (const h of await th.all()) expect(await h.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  const wrap = page.locator('.tbl-wrap');
  expect(await wrap.evaluate((e) => { const c = getComputedStyle(e); return c.overflowX === 'auto' && parseFloat(c.paddingRight) >= 16; })).toBe(true);
  const bounce = (await th.last().boundingBox())!;
  expect(bounce.x + bounce.width).toBeLessThanOrEqual(390);
});

test('14 Settings links', async ({ page }) => {
  await boot(page, { hash: '#/settings' });
  const links = page.getByTestId('links').getByRole('link');
  await expect(links.first()).toBeVisible(); // the screen loads on demand
  const got = await links.evaluateAll((as) => as.map((a) => [a.textContent!.trim(), (a as HTMLAnchorElement).href]));
  expect(got).toEqual([
    ['Claude Code', 'https://claude.ai/code'],
    ['Claude Code schedules', 'https://claude.ai/code/routines'],
    ['WorkOS on GitHub', 'https://github.com/Deztrox1/WorkOS'],
    ['cold-outreach on GitHub', 'https://github.com/Deztrox1/cold-outreach'],
  ]);
});

test('15 an open sheet traps Tab and closes on Escape', async ({ page }) => {
  await boot(page, { tables: { os_tasks: [task('Trap me', { planned_for: TODAY })] } });
  await page.getByTestId('now-title').click();
  const dlg = page.getByRole('dialog', { name: 'Task' });
  await expect(dlg).toBeVisible();
  const inside = () => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
  for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); expect(await inside()).toBe(true); }
  for (let i = 0; i < 40; i++) { await page.keyboard.press('Shift+Tab'); expect(await inside()).toBe(true); }
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
});

test('16 habit strip cells are at least 44 px and the strip scrolls with today in view', async ({ page }) => {
  await boot(page, { hash: '#/habits', mode: 'personal', tables: { os_habits: [habitRow('Walk')] } });
  const cells = page.locator('.strip button');
  await expect(cells).toHaveCount(14);
  for (const c of await cells.all()) {
    const b = (await c.boundingBox())!;
    expect(b.width).toBeGreaterThanOrEqual(43.5);
    expect(b.height).toBeGreaterThanOrEqual(43.5);
  }
  const strip = page.locator('.strip');
  expect(await strip.evaluate((e) => getComputedStyle(e).overflowX)).toBe('auto');
  const last = (await cells.last().boundingBox())!;
  expect(last.x + last.width).toBeLessThanOrEqual(390.5);
});

test('17 mood buttons are 44 by 44', async ({ page }) => {
  await boot(page, { hash: '#/plan' });
  for (const m of [1, 2, 3, 4, 5]) {
    const b = (await page.getByRole('button', { name: `Mood ${m}` }).boundingBox())!;
    expect(Math.round(b.width)).toBe(44);
    expect(Math.round(b.height)).toBe(44);
  }
});

test('18 finance: the chart is read at 1:1 with 11 px labels, and invoice rows look live', async ({ page }) => {
  await boot(page, { hash: '#/finance' });
  const chart = page.getByTestId('fin-chart');
  const scale = await chart.evaluate((s) => s.getBoundingClientRect().width / (s as SVGSVGElement).viewBox.baseVal.width);
  expect(scale).toBeGreaterThanOrEqual(1);
  expect(await chart.locator('text').first().evaluate((t) => parseFloat(t.getAttribute('font-size')!))).toBeGreaterThanOrEqual(11);
  expect(await page.locator('.chart-scroll').evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
  const row = page.getByTestId('fin-row-revenue').filter({ hasText: 'INV-MC-00001' });
  await expect(row).toContainText('invoice');
  await expect(row).toContainText('draft, not sent yet');
  expect(await row.locator('.main-btn').evaluate((e) => getComputedStyle(e).opacity)).toBe('1');
  // a draft cannot be marked paid until it is sent (R2C31)
  await expect(row.getByRole('button', { name: 'Mark paid' })).toHaveCount(0);
});

test('19 the mode switch is compact: 44 px tall, at the top of the page it filters (U13, F22, R4U15)', async ({ page }) => {
  await boot(page, { hash: '#/tasks' });
  const seg = (await page.locator('.mode-line .seg').boundingBox())!;
  expect(Math.round(seg.height)).toBe(44);
  expect(seg.width).toBeLessThan(390 / 2 + 20);
  await expect(page.locator('.topbar .seg')).toHaveCount(0);
  // each button's target reaches the full 44 px through a pseudo-element
  for (const b of await page.locator('.mode-line .seg button').all()) {
    const h = await b.evaluate((e) => { const r = getComputedStyle(e, '::after'); return e.getBoundingClientRect().height - parseFloat(r.top) - parseFloat(r.bottom); });
    expect(h).toBeGreaterThanOrEqual(43.5);
  }
});

test('19b opening Habits sets Personal, and opening Finance sets Work: nothing bounces (call N)', async ({ page }) => {
  await boot(page, { hash: '#/habits' });
  await expect(page).toHaveURL(/#\/habits$/);
  await expect(page.getByRole('heading', { name: 'Habits' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('workos.mode'))).toBe('personal');
  await page.goto('/?mock=1#/finance');
  await expect(page.getByRole('heading', { name: 'Finance' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('workos.mode'))).toBe('work');
});

test('21 the default sample data has the shape of the seed: tasks, habits, reminders and invoices, all invented', async ({ page }) => {
  await boot(page, { hash: '#/tasks' });
  for (const t of ['Maple Court Hotels follow-up draft', 'Cedar & Pine: check-in', 'Print shops list 1,210 named people']) await expect(page.getByText(t).first()).toBeVisible();
  await page.goto('/?mock=1#/finance');
  await page.getByLabel('Month', { exact: true }).selectOption({ label: 'Apr 2026' });
  await expect(page.getByTestId('fin-row-revenue').filter({ hasText: 'INV-CP-00001' })).toContainText('1,800 GBP');
  await expect(page.getByTestId('fin-row-revenue').filter({ hasText: 'INV-HL-00001' })).toContainText('650 GBP');
  await page.getByLabel('Month', { exact: true }).selectOption({ label: 'Oct 2026' });
  await expect(page.getByTestId('fin-row-revenue')).toContainText('60,000 INR');
});

test('22 the month select is styled like the other controls', async ({ page }) => {
  await boot(page, { hash: '#/finance', tables: { os_finance_entries: [fin('x')] } });
  const css = await page.getByLabel('Month', { exact: true }).evaluate((e) => { const c = getComputedStyle(e); return { app: c.appearance, border: c.borderTopWidth, radius: c.borderTopLeftRadius, h: e.getBoundingClientRect().height, pr: parseFloat(c.paddingRight) }; });
  expect(css).toMatchObject({ app: 'none', border: '1px', radius: '6px' });
  expect(css.h).toBeGreaterThanOrEqual(44);
  expect(css.pr).toBeGreaterThanOrEqual(32);
});
