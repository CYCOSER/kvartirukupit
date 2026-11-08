import { test, expect } from '@playwright/test';

test('all six purchase steps stay readable on desktop and mobile', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const steps = page.locator('#process .steps > div');
  await expect(steps.locator('h3')).toHaveText([
    'Обсуждаем', 'Показываем', 'Готовимся к покупке', 'Оформляем', 'Принимаем', 'Дарим подарки',
  ]);
  await expect(page.locator('#process .steps > div > span')).toHaveText(['01', '02', '03', '04', '05', '06']);
  for (const width of [1440, 1024, 800, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator('#process').scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    const boxes = await steps.evaluateAll(elements => elements.map(element => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, bottom: box.bottom };
    }));
    if (width > 800) {
      expect(boxes[0].y).toBe(boxes[2].y);
      expect(boxes[3].y).toBeGreaterThan(boxes[0].bottom);
      expect(boxes[3].x).toBe(boxes[0].x);
    } else {
      for (let index = 1; index < boxes.length; index++) {
        expect(boxes[index].y).toBeGreaterThanOrEqual(boxes[index - 1].bottom);
        expect(boxes[index].x).toBe(boxes[0].x);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 1440 || width === 390) {
      await page.locator('#process').screenshot({ path: testInfo.outputPath(`purchase-steps-${width}.png`) });
    }
  }
});
