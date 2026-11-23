import { test, expect } from '@playwright/test';
import { propertyFixture } from './fixtures/property';

test('public cards show feature and location tags before construction status without the developer', async ({ page }) => {
  const developer = 'Застройщик только для администратора';
  const complex = propertyFixture({
    id: 'features-complex', slug: 'features-complex', title: 'ЖК с отоплением', type: 'complex', housingMarket: null,
    developer, features: [
      { id: 'gas', name: 'Газовое автономное', group: 'heating' },
      { id: 'fence', name: 'Огороженная территория', group: 'territory' },
      { id: 'center', name: 'Центр города', group: 'location' },
      { id: 'sea', name: 'У моря', group: 'location' },
    ], constructionStatus: 'сдан',
  });
  const apartment = propertyFixture({
    id: 'features-apartment', slug: 'features-apartment', title: 'Квартира с отоплением', developer, complex,
    features: [], featureOverrides: [], constructionStatus: 'строится',
  });
  const unknown = propertyFixture({
    id: 'features-unknown', slug: 'features-unknown', title: 'ЖК без сведений', type: 'complex', housingMarket: null,
    developer, features: [], featureOverrides: [],
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route(`**/api/properties/${apartment.slug}`, route => route.fulfill({ json: apartment }));
  await page.route('**/api/properties?*', route => route.fulfill({
    json: { items: [complex, apartment, unknown], total: 3, pages: 1, locations: ['Калининград'] },
  }));
  await page.goto('/catalog');
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as Element & { __vue_app__?: unknown })?.__vue_app__);
  await page.getByTestId('catalog-title-search-input').fill('Отопление');
  await page.getByTestId('catalog-title-search-submit').click();

  const cards = page.locator('.catalog-grid .property-card');
  await expect(cards).toHaveCount(3);
  for (const [property, status] of [[complex, 'Сдан'], [apartment, 'Строится']] as const) {
    const card = cards.filter({ has: page.getByRole('heading', { name: property.title, exact: true }) });
    const features = card.locator('.property-features');
    await expect(card).not.toContainText(developer);
    await expect(features).toContainText('Отопление: Газовое автономное');
    await expect(features).toContainText('Огороженная территория');
    await expect(features).toContainText(new RegExp(`Отопление:[\\s\\S]*Центр города[\\s\\S]*У моря[\\s\\S]*${status}\\s*$`));
    await expect(features.locator('svg')).toHaveCount(5);
    await expect(features.locator('.property-construction-status')).toHaveText(status);
    await expect(features.locator('.property-construction-status svg')).toHaveCount(1);
  }
  await expect(cards.filter({ hasText: unknown.title }).locator('.property-features')).toHaveCount(0);
  await expect(page.locator('.footer-script')).toHaveText('Ваш Калининград');
  await expect(page.locator('.footer-brand-group > p')).not.toContainText('пространство.');

  await page.setViewportSize({ width: 390, height: 1000 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.locator(`.catalog-grid a[href="/catalog/${apartment.slug}"]`).click();
  const story = page.locator('#about-property');
  await expect(story.locator('h2')).toContainText('О квартире');
  await expect(story).not.toContainText(developer);
  await expect(story.getByText('Застройщик', { exact: true })).toHaveCount(0);
  await expect(story.locator('.property-features')).toContainText('Отопление: Газовое автономное');
  await expect(story.locator('.property-features')).toContainText('Огороженная территория');
  await expect(story.locator('.property-features')).toContainText(/Центр города[\s\S]*У моря/);
  await expect(story.locator('.property-features svg')).toHaveCount(4);
  await expect(story.locator('.property-construction-status')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
