import { test, expect } from '@playwright/test';
import { propertyFixture } from './fixtures/property';

test('apartment and complex cards share dates and full addresses, and apartments show their complex and plan', async ({ page }) => {
  const base = propertyFixture();
  const complex = {
    ...base, id: 'card-complex', slug: 'card-complex', title: 'Тихий дом', type: 'complex',
    address: 'Калининград, Сержанта Мишина ул., д. 81', location: 'Калининград',
    developer: 'Интер-Инвест', constructionStatus: 'сдан', readiness: 'II кв. 2024', complex: null,
    images: [{ id: 'photo', file: '/images/baltic-terrace.webp', alt: 'Дом', order: 0, kind: 'photo' }],
  };
  const apartment = {
    ...complex, id: 'card-apartment', slug: 'card-apartment', title: '2-к кв. 55.4 м²', type: 'apartment',
    priceKind: 'from', price: 7200000,
    address: 'Сержанта Мишина ул., д. 81', constructionStatus: 'Сдан', readiness: 'Сдан, 2 кв. 2024',
    complex: { id: complex.id, title: complex.title, slug: complex.slug, published: true },
    images: [{ id: 'plan', file: '/images/baltic-coast.webp', alt: 'Планировка', order: 0, kind: 'plan' }],
  };
  await page.goto('/catalog');
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as Element & { __vue_app__?: unknown })?.__vue_app__);
  await page.route('**/api/properties?*', route => route.fulfill({
    json: { items: [apartment, complex], total: 2, pages: 1, locations: ['Калининград'] },
  }));
  await page.getByTestId('catalog-title-search-input').fill('Проверка карточек');
  await page.getByTestId('catalog-title-search-submit').click();
  for (const slug of [apartment.slug, complex.slug]) {
    const card = page.locator(`.property-card[href="/catalog/${slug}"]`);
    await expect(card).toBeVisible();
    await card.hover();
    await expect(card.locator('.card-location')).toHaveText('Калининград, Сержанта Мишина ул., д. 81');
    await expect(card.locator('.card-price > span')).toHaveText('II кв. 2024');
    await expect(card.getByText('Сдан', { exact: true })).toHaveCount(1);
  }
  const apartmentCard = page.locator(`.property-card[href="/catalog/${apartment.slug}"]`);
  await expect(apartmentCard.locator('.card-specs')).toContainText('ЖК Тихий дом');
  await expect(apartmentCard.locator('.card-specs')).not.toContainText('Интер-Инвест');
  await expect(apartmentCard.locator('.card-price-amount > small')).toHaveText('от');
  await expect(apartmentCard.locator('.card-image-link img')).toHaveCSS('object-fit', 'contain');
  await expect(page.locator(`.property-card[href="/catalog/${complex.slug}"] .card-specs`)).toContainText('Интер-Инвест');
});

for (const width of [1440, 900, 390]) {
  test(`map floor plans stay clear and separate from details at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const apartment = propertyFixture({
      id: 'map-plan', slug: 'map-plan', title: '3-к кв. 92.5 м²', price: 10198125, readiness: 'II кв. 2027', status: 'reserved', latitude: 54.71, longitude: 20.52,
      images: [{ id: 'plan', file: '/test-floor-plan.svg', alt: 'Планировка', order: 0, kind: 'plan' }],
    });
    const photo = propertyFixture({
      id: 'map-photo', slug: 'map-photo', title: 'Квартира с фотографией', latitude: 54.72, longitude: 20.53,
      images: [{ id: 'photo', file: '/images/baltic-terrace.webp', alt: 'Дом', order: 0, kind: 'photo' }],
    });
    await page.route('**/test-floor-plan.svg', route => route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="200"><rect width="100" height="200" fill="white"/><rect x="5" y="5" width="90" height="190" fill="none" stroke="black" stroke-width="2"/></svg>',
    }));
    await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({
      contentType: 'image/png',
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO24AAAAASUVORK5CYII=', 'base64'),
    }));
    await page.route('**/api/properties/map?*', route => route.fulfill({
      json: { items: [apartment, photo], total: 2, pages: 1, locations: ['Калининград'] },
    }));
    await page.goto('/catalog');
    await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as Element & { __vue_app__?: unknown })?.__vue_app__);
    await page.getByRole('button', { name: 'Карта', exact: true }).click();
    const row = page.locator('[data-testid="catalog-map-item"][data-property-id="map-plan"]');
    const card = row.locator('.property-card');
    const image = card.locator('.card-image-link img');
    await expect(image).toBeVisible();
    await expect(image).toHaveCSS('object-fit', 'contain');
    await expect(image).toHaveCSS('filter', 'none');
    await expect(card.locator('.card-photo-focus')).toBeHidden();
    expect(await card.locator('.card-body').evaluate(el => getComputedStyle(el, '::before').display)).toBe('none');
    expect(await card.locator('.card-image-link').evaluate(el => getComputedStyle(el, '::after').display)).toBe('none');
    const thumbnail = (await card.locator('.card-image-link').boundingBox())!;
    const summary = (await card.locator('.card-body').boundingBox())!;
    expect(thumbnail.x).toBeGreaterThanOrEqual(summary.x + summary.width - 1);

    const photoCard = page.locator('[data-property-id="map-photo"] .property-card');
    await expect(photoCard).not.toHaveClass(/catalog-panel-plan/);
    await expect(photoCard.locator('.card-image-link img')).toHaveCSS('object-fit', 'cover');

    await row.getByTestId('catalog-map-toggle').click();
    await expect(row).toHaveAttribute('data-expanded', 'true');
    await expect(image).toHaveCSS('object-fit', 'contain');
    await expect(card.locator('.card-photo-focus')).toBeHidden();
    const expandedImage = (await card.locator('.card-image-link').boundingBox())!;
    const details = (await card.locator('.card-body').boundingBox())!;
    expect(expandedImage.y + expandedImage.height).toBeLessThanOrEqual(details.y + 1);
    expect(expandedImage.width).toBeGreaterThan(thumbnail.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
