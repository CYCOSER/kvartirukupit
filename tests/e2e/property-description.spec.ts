import { test, expect } from '@playwright/test';
import { propertyFixture } from './fixtures/property';

test('long property descriptions use the full section without mobile overflow', async ({ page }, testInfo) => {
  const description = Array.from({ length: 12 }, (_, index) =>
    `Абзац ${index + 1}. Светлая квартира с ремонтом, просторной кухней и изолированными комнатами. Из окон открывается вид на тихий двор.`,
  ).join('\n\n');
  const property = propertyFixture({
    description, elite: true, developer: 'Строительная компания Калининграда',
    finish: 'Чистовая отделка: подготовлены стены, уложены полы и установлена сантехника',
    utilities: ['Газ', 'Лифт'],
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route(`**/api/properties/${property.slug}`, route => route.fulfill({ json: property }));
  await page.route('**/api/properties?*', route => route.fulfill({
    json: { items: [property], total: 1, pages: 1, locations: ['Калининград'] },
  }));
  await page.goto('/catalog');
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as Element & { __vue_app__?: unknown })?.__vue_app__);
  await page.getByTestId('catalog-title-search-input').fill('Описание');
  await page.getByTestId('catalog-title-search-submit').click();
  await page.locator(`a[href="/catalog/${property.slug}"]`).first().click();
  const story = page.locator('#about-property');
  await expect(story.locator('h2')).toContainText('О квартире');
  await expect(story.locator('h2 .type-script')).toHaveText('Для вас');
  await expect(story.getByRole('heading', { name: 'Коммуникации и удобства' })).toHaveCount(0);
  await expect(story.locator('.utilities')).toHaveCount(0);
  await expect(page.locator('.detail-hero').getByRole('link', { name: 'Квартиры с ремонтом' })).toBeVisible();
  await expect(story.locator('.detail-description')).toHaveText(description);
  for (const width of [1440, 801, 800, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await story.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const geometry = await story.evaluate(section => {
      const heading = section.querySelector('h2')!.getBoundingClientRect();
      const attributes = section.querySelector('.detail-attributes')!.getBoundingClientRect();
      const body = section.querySelector('.detail-story-body')!.getBoundingClientRect();
      const description = section.querySelector('.detail-description')!;
      const range = document.createRange();
      range.selectNodeContents(description);
      const lines = [...range.getClientRects()].filter(line => line.width > 0);
      const sectionBounds = section.getBoundingClientRect();
      const style = getComputedStyle(section);
      return {
        headingBottom: heading.bottom, attributesTop: attributes.top, attributesBottom: attributes.bottom,
        bodyBottom: body.bottom, firstLineTop: lines[0].top, firstLineRight: lines[0].right,
        attributesLeft: attributes.left,
        wrapsBelow: lines.some(line => line.top >= attributes.bottom && line.right > attributes.left + 16),
        bodyWidth: body.width,
        contentWidth: sectionBounds.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        viewport: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
      };
    });
    expect(geometry.firstLineTop).toBeGreaterThanOrEqual(geometry.headingBottom);
    expect(geometry.firstLineTop - geometry.headingBottom).toBeLessThan(64);
    expect(geometry.bodyWidth).toBeCloseTo(geometry.contentWidth, 0);
    if (width > 800) {
      expect(geometry.firstLineTop).toBeLessThan(geometry.attributesBottom);
      expect(geometry.firstLineRight).toBeLessThanOrEqual(geometry.attributesLeft);
      expect(geometry.wrapsBelow).toBe(true);
    } else {
      expect(geometry.attributesTop).toBeGreaterThanOrEqual(geometry.bodyBottom);
    }
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewport);
    if (width === 1440 || width === 390) {
      await story.screenshot({ path: testInfo.outputPath(`property-description-${width}.png`) });
    }
  }
});
