import { defineConfig, devices } from '@playwright/test';

// Drives the real app in a browser. Requires a Chromium binary
// (`npx playwright install chromium`) and a running/seeded local DB
// (`npm run db:setup`). The webServer block starts `next dev` for you.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
