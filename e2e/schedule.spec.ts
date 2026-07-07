import { test, expect } from '@playwright/test';

// The /schedule summary page renders the picked tournaments when a ?build=
// chain is present, and otherwise keeps its historical behaviour of sending
// visitors to the calendar. An empty/unknown chain must never 500.
test.describe('schedule summary', () => {
  test('bare /schedule redirects to the calendar', async ({ page }) => {
    await page.goto('/schedule');
    await expect(page).toHaveURL(/\/cuts/);
  });

  test('an unknown build chain falls back to the calendar (no crash)', async ({ page }) => {
    await page.goto('/schedule?build=00000000-0000-0000-0000-000000000000');
    await expect(page).toHaveURL(/\/cuts/);
  });
});
