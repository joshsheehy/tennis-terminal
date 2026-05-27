import { test, expect } from '@playwright/test';

// Verifies the core behaviour of the pill filters: the week-grouped dropdowns
// stay in place (the app does not collapse into a flat list) and rows are
// narrowed to the selected level. Assumes the seeded dev DB (npm run db:setup).
test.describe('tournament pill filters', () => {
  test('clicking a level pill keeps the week dropdowns and filters rows', async ({ page }) => {
    await page.goto('/');

    const weeks = page.locator('details[data-week-key]');
    await expect(weeks.first()).toBeVisible();

    await page.getByRole('button', { name: 'Challenger', exact: true }).click();

    // Week dropdowns are still the layout (not replaced by the flat search list).
    await expect(weeks.first()).toBeVisible();
    await expect(page.locator('[data-search]:visible')).toHaveCount(0);

    // Expand the first still-visible week and confirm its rows are all Challenger.
    const firstWeek = weeks.filter({ has: page.locator('[data-week-row]') }).first();
    await firstWeek.locator('summary').click();
    const visibleRows = firstWeek.locator('[data-week-row]:visible');
    const count = await visibleRows.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(visibleRows.nth(i)).toHaveAttribute('data-level-cat', 'Challenger');
    }
  });
});
