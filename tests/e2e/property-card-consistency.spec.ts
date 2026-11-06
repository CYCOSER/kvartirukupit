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
