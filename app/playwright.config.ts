import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  workers: 4,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'off', ...devices['Desktop Chrome'], timezoneId: 'America/Los_Angeles', permissions: [] },
  projects: [
    { name: 'phone', testIgnore: /\.desktop\.spec\.ts/, use: { viewport: { width: 390, height: 844 }, hasTouch: true } },
    { name: 'desktop', testMatch: /\.desktop\.spec\.ts/, use: { viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
