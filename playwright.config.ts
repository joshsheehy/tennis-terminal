import { defineConfig, devices } from '@playwright/test';

// Drives the real app in a browser. Requires a Chromium binary
// (`npx playwright install chromium`) and a running/seeded local DB
// (`npm run db:setup`). The webServer block starts `next dev` for you.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // Absorb one-off flake (slow cold compile, transient timeout) in CI so a
  // transient blip doesn't fail the run and email the owner. Local runs keep
  // retries at 0 so real breakage stays loud while developing.
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    // Optional escape hatch for sandboxes with a system Chromium at a fixed
    // path (set PW_CHROMIUM_PATH). Unset means Playwright's own download, as
    // in CI, so this is a no-op there.
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
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
