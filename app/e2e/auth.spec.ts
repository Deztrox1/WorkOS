/** Stories covered: SI-01 SI-02 SI-03 SI-04 SI-05 SI-07 SI-06. */
import { expect, test } from '@playwright/test';
import { boot } from './helpers';

test('SI-01 sign in lands on Today with a session', async ({ page }) => {
  await boot(page, { signedIn: false, hash: '#/signin' });
  await page.getByLabel('Email').fill('owner@example.com');
  await page.getByLabel('Password').fill('correct-horse');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByTestId('greeting')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('workos.mock.session'))).toBe('owner@example.com');
});

test('SI-02 wrong password shows an error and no mode switch', async ({ page }) => {
  await boot(page, { signedIn: false, hash: '#/signin' });
  await page.getByLabel('Email').fill('owner@example.com');
  await page.getByLabel('Password').fill('wrong-pass');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Wrong email or password');
  await expect(page).toHaveURL(/#\/signin/);
  await expect(page.getByRole('button', { name: 'Personal' })).toHaveCount(0);
});

test('SI-03 forgot password sends one reset request and confirms', async ({ page }) => {
  await boot(page, { signedIn: false, hash: '#/signin' });
  await page.getByLabel('Email').fill('owner@example.com');
  await page.getByRole('button', { name: 'Forgot password' }).click();
  await expect(page.getByRole('status')).toContainText('reset link');
  expect(await page.evaluate(() => (window as unknown as { __resetRequests: string[] }).__resetRequests.length)).toBe(1);
});

test('SI-04 recovery link opens the new password form', async ({ page }) => {
  await boot(page, { signedIn: false, hash: '#/reset#access_token=T&refresh_token=R&type=recovery' });
  await expect(page.getByRole('heading', { name: 'New password' })).toBeVisible();
  await expect(page.getByLabel('New password')).toBeVisible();
  expect(await page.evaluate(() => location.hash)).toBe('#/reset');
});

test('SI-04b a recovery link is refused while another account is signed in, and the session stays (R2S08)', async ({ page }) => {
  await boot(page, { signedIn: true, hash: '#/reset#access_token=T&refresh_token=R&type=recovery' });
  await expect(page.getByText('This link has expired.')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('workos.mock.session'))).toBe('owner@example.com');
});

test('R3S09 the reset screen says which account the new password is for', async ({ page }) => {
  await boot(page, { signedIn: true, hash: '#/reset' });
  await expect(page.getByTestId('reset-for')).toHaveText('For owner@example.com');
});

test('SI-04c a different user signing in on this browser starts with an empty cache (R2S08)', async ({ page }) => {
  await boot(page, { signedIn: true, tables: { os_tasks: [] } });
  await expect(page.getByTestId('greeting')).toBeVisible();
  await page.evaluate(() => {
    localStorage.setItem('workos.cache.user', 'someone@else.com');
    localStorage.setItem('workos.cache.tasks', JSON.stringify({ rows: [{ id: 'g', title: 'Ghost task of another user', status: 'open', area: 'work' }], at: Date.now() }));
  });
  await page.reload();
  await expect(page.getByTestId('greeting')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('workos.cache.user'))).toBe('owner@example.com');
  expect(await page.evaluate(() => localStorage.getItem('workos.cache.tasks') ?? '')).not.toContain('Ghost task');
  await expect(page.getByText('Ghost task of another user')).toHaveCount(0);
});

test('SI-05 the session survives a reload', async ({ page }) => {
  await boot(page, { signedIn: false, hash: '#/signin' });
  await page.getByLabel('Email').fill('owner@example.com');
  await page.getByLabel('Password').fill('correct-horse');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('greeting')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('greeting')).toBeVisible();
});

test('SI-07 signed out visit to a page lands on Sign in and loads no data', async ({ page }) => {
  await boot(page, { signedIn: false, hash: '#/tasks' });
  await expect(page).toHaveURL(/#\/signin/);
  expect(await page.evaluate(() => localStorage.getItem('workos.cache.tasks'))).toBeNull();
});

test('SI-06 Sign in has no Create account link, Forgot password stays', async ({ page }) => {
  await boot(page, { signedIn: false, hash: '#/signin' });
  await expect(page.getByRole('button', { name: 'Forgot password' })).toBeVisible();
  await expect(page.getByText('Create account')).toHaveCount(0);
});
