import { test, expect } from '@playwright/test';

test('header switches to menu before navigation wraps', async ({ page }) => {
  for (const width of [760, 800, 900, 1000, 1100]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    await expect(page.locator('.mobile-menu')).toBeVisible();
    await expect(page.locator('.desktop-nav')).toBeHidden();
    expect(await page.locator('.header-inner').evaluate(el => getComputedStyle(el).flexWrap)).toBe('nowrap');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  }
  await page.setViewportSize({ width: 1101, height: 800 });
  await page.goto('/');
  await expect(page.locator('.desktop-nav')).toBeVisible();
  await expect(page.locator('.mobile-menu')).toBeHidden();
  const lines = await page.locator('.desktop-nav a').evaluateAll(links => links.map(link => {
    const range = document.createRange();
    range.selectNodeContents(link);
    return range.getClientRects().length;
  }));
  expect(lines.every(value => value === 1)).toBeTruthy();
});
