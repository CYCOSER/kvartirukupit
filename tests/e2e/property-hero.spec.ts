import { test, expect } from '@playwright/test';
import type { Property } from '../../shared/property';
import { propertyFixture } from './fixtures/property';

test('property page keeps words intact and gallery actions usable without mobile overflow', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const property = propertyFixture();
  await page.route('**/api/properties?*', route => route.fulfill({
    json: { items: [property], total: 1, pages: 1, locations: ['Калининград'] },
  }));
  let complexTitle = 'Тихий дом';
  await page.route(`**/api/properties/${property.slug}`, route => route.fulfill({ json: {
    ...property, title: '2-к кв. 56.2 м²', price: 14685079, readiness: 'II кв. 2024',
    district: 'Центральный район', constructionStatus: 'Строительство завершено',
    complex: { id: 'hero-fixture', title: complexTitle, slug: 'hero-fixture', published: true },
  } }));
  for (const width of [737, 600, 320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/catalog?type=apartment');
    await page.getByTestId('catalog-title-search-input').fill(property.title);
    await page.getByTestId('catalog-title-search-submit').click();
    await page.locator(`a[href="/catalog/${property.slug}"]`).first().click();
    await expect(page.locator('.detail-title')).toHaveText('2-к кв. 56.2 м²');
    await expect(page.locator('.detail-hero-script')).toHaveText('ЖК ' + complexTitle);
    await expect(page.locator('.detail-hero-price')).toHaveCSS('font-weight', '400');
    await expect(page.locator('.detail-hero-price')).toHaveCSS('color', 'rgb(255, 255, 255)');
    await page.evaluate(() => document.fonts.ready);
    const geometry = await page.locator('.detail-hero').evaluate(hero => {
      const panel = hero.querySelector('.scene-panel')!.getBoundingClientRect();
      const aside = hero.querySelector('.scene-aside')!.getBoundingClientRect();
      const title = hero.querySelector('.detail-title')!.getBoundingClientRect();
      const script = hero.querySelector('.detail-hero-script')!.getBoundingClientRect();
      const price = hero.querySelector('.detail-hero-price')!;
      const priceRange = document.createRange();
      priceRange.selectNodeContents(price);
      return {
        panelRight: panel.right, panelBottom: panel.bottom, asideLeft: aside.left, asideTop: aside.top,
        titleBottom: title.bottom, scriptTop: script.top, scriptRight: script.right,
        viewport: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        priceFits: [...priceRange.getClientRects()].every(rect => rect.left >= aside.left && rect.right <= aside.right),
        priceLines: priceRange.getClientRects().length,
      };
    });
    expect(geometry.scriptTop).toBeLessThan(geometry.titleBottom);
    expect(geometry.scriptRight).toBeLessThanOrEqual(geometry.viewport);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewport);
    expect(geometry.priceFits).toBe(true);
    expect(geometry.priceLines).toBe(1);
    if (width > 540) expect(geometry.asideLeft).toBeGreaterThan(geometry.panelRight);
    else expect(geometry.asideTop).toBeGreaterThan(geometry.panelBottom);
    const words = await page.locator('.detail-spec-text dd').evaluateAll(elements => elements.flatMap(element => {
      const node = element.firstChild!;
      const bounds = element.getBoundingClientRect();
      return [...node.textContent!.matchAll(/\p{L}+/gu)].map(match => {
        const range = document.createRange();
        range.setStart(node, match.index!);
        range.setEnd(node, match.index! + match[0].length);
        const rects = [...range.getClientRects()];
        return { word: match[0], lines: rects.length, fits: rects.every(rect => rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1) };
      });
    }));
    for (const word of words) {
      expect(word.lines, `${word.word} at ${width}px`).toBe(1);
      expect(word.fits, `${word.word} at ${width}px`).toBe(true);
    }
    const action = page.getByTestId('property-map-link');
    await expect(page.locator('.detail-gallery-aside').getByRole('link')).toHaveCount(1);
    await expect(action).toHaveText('Посмотреть на карте');
    const height = await action.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return rect.height;
    });
    expect(height).toBeGreaterThanOrEqual(48);
    await action.focus();
    await expect(action).toBeFocused();
    await action.screenshot({ path: testInfo.outputPath(`gallery-actions-${width}.png`) });
    await page.locator('.detail-specs').screenshot({ path: testInfo.outputPath(`property-facts-${width}.png`) });
    if (width === 737) await page.screenshot({ path: testInfo.outputPath('tablet-hero.png') });
    complexTitle = 'Тихий дом — жилой квартал на побережье';
  }
});

test('complex hero shows its city, overlapping label and a nearby down arrow', async ({ page }, testInfo) => {
  const response = await page.request.get('/api/properties', { params: { type: 'complex' } });
  expect(response.ok()).toBe(true);
  const { items } = await response.json();
  const property = items.find((item: Property) => item.status !== 'sold') as Property;
  expect(property).toBeTruthy();
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/catalog/' + property.slug);
    const hero = page.locator('.detail-hero');
    await expect(hero.locator('.eyebrow')).toHaveText(property.location);
    await expect(hero.locator('.detail-hero-script')).toHaveText('Жилой комплекс');
    const action = hero.getByRole('link', { name: 'Записаться на просмотр' });
    await expect(action).toHaveAttribute('href', '#property-enquiry');
    await expect(action.locator('.lucide-arrow-down')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const geometry = await hero.evaluate(element => {
      const title = element.querySelector('h1')!.getBoundingClientRect();
      const script = element.querySelector('.detail-hero-script')!.getBoundingClientRect();
      const action = element.querySelector('.detail-hero-cta')!;
      return { titleBottom: title.bottom, scriptTop: script.top,
        scriptRight: script.right, width: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth, gap: parseFloat(getComputedStyle(action).gap) };
    });
    expect(geometry.scriptTop).toBeLessThan(geometry.titleBottom);
    expect(geometry.scriptRight).toBeLessThanOrEqual(geometry.width);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width);
    expect(geometry.gap).toBeLessThanOrEqual(16);
    await hero.screenshot({ path: testInfo.outputPath(`complex-hero-${width}.png`) });
    await action.click();
    await expect(page.locator('#property-enquiry')).toBeInViewport();
  }
});
