import { defineConfig, devices } from '@playwright/test';
const port = Number(process.env.OPENATHAN_BROWSER_TEST_PORT ?? 4321);
const built = process.env.OPENATHAN_BROWSER_TEST_BUILT === '1';
export default defineConfig({
  testDir: './tests/browser',
  testIgnore: built ? ['**/installer.spec.ts'] : [],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'webkit' } },
  ],
  webServer: {
    command: built
      ? `npm run preview -- --host 127.0.0.1 --port ${port} --ignore-lock`
      : `npm run dev -- --host 127.0.0.1 --port ${port} --ignore-lock`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI && !built,
    timeout: 30_000,
  },
});
