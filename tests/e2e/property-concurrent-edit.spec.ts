import { test, expect, type Page } from '@playwright/test';
import { mergePropertyUpdate, parsePropertyUpdate } from '../../shared/property-edit';

async function editor(page: Page) {
  const state = {
    item: {
      id: 'concurrent-edit', title: 'Квартира с синхронизацией', slug: 'concurrent-edit', type: 'apartment',
      housingMarket: null, complexId: null, nmarketComplexId: null, rf39ComplexId: null, rf39BuildingId: null,
      location: 'Калининград', address: 'Мира, 1', latitude: null, longitude: null,
      price: 5000000, status: 'available', area: 50, landArea: null, bedrooms: 2, floors: 5,
      readiness: 'Готов', finish: 'Чистовая', seaDistance: null, description: 'Исходное описание', utilities: [],
      published: false, featured: false, elite: false, demo: false, sourceId: 'rf39:42',
      images: [{ id: 'photo-one', file: '/images/baltic-coast.webp', alt: 'Первое фото', order: 0 }],
    },
    updates: [] as ReturnType<typeof parsePropertyUpdate>[],
    galleries: [] as { id: string; alt: string }[][],
    delayNext: false,
    release: () => {},
  };
  await page.route('**/api/admin/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/admin/login' || url.pathname === '/api/admin/me')
      return route.fulfill({ json: { id: 'fixture-admin', email: 'fixture@example.com' } });
    if (url.pathname === '/api/admin/import-jobs') return route.fulfill({ json: [] });
    if (url.pathname === '/api/admin/properties')
      return route.fulfill({ json: url.searchParams.has('type') ? [] : [state.item] });
    if (url.pathname === '/api/admin/properties/' + state.item.id) {
      if (route.request().method() === 'PUT') {
        const update = parsePropertyUpdate(route.request().postDataJSON());
        state.updates.push(update);
        Object.assign(state.item, mergePropertyUpdate(state.item, update));
        if (state.delayNext) {
          state.delayNext = false;
          await new Promise<void>(resolve => { state.release = resolve; });
        }
      }
      return route.fulfill({ json: state.item });
    }
    if (url.pathname === `/api/admin/properties/${state.item.id}/images` && route.request().method() === 'PUT') {
      const gallery = route.request().postDataJSON() as { id: string; alt: string }[];
      state.galleries.push(gallery);
      state.item.images = gallery.map((image, order) => ({ ...state.item.images.find(old => old.id === image.id)!, ...image, order }));
      return route.fulfill({ json: { ok: true } });
    }
    throw new Error('Unexpected request: ' + route.request().method() + ' ' + url.pathname);
  });
  await page.goto('/admin-console-9Xk6uiIs/login');
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__);
  await page.getByLabel('Email', { exact: true }).fill('fixture@example.com');
  await page.getByLabel('Пароль', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('link', { name: state.item.title, exact: true }).click();
  await expect(page.getByLabel('Описание', { exact: true })).toHaveValue('Исходное описание');
  return state;
}

test('manual description preserves a concurrent feed update and unchanged gallery is never rewritten', async ({ page }) => {
  const state = await editor(page);
  Object.assign(state.item, { price: 6200000, published: true, elite: true });
  state.item.images.push({ id: 'photo-two', file: '/images/baltic-terrace.webp', alt: 'Фото из другой вкладки', order: 1 });
  await page.getByLabel('Описание', { exact: true }).fill('Ручное описание');
  await page.getByRole('button', { name: 'Сохранить объект', exact: true }).click();
  await expect(page.getByText('Объект сохранён.', { exact: true })).toBeVisible();
  expect(state.updates[0].changedFields).toEqual(['description']);
  expect(state.item).toMatchObject({ price: 6200000, published: true, elite: true, description: 'Ручное описание' });
  expect(state.galleries).toHaveLength(0);
  await expect(page.getByLabel('Цена, ₽ (пусто — по запросу)', { exact: true })).toHaveValue('6200000');
  await expect(page.getByRole('checkbox', { name: 'Опубликован', exact: true })).toBeChecked();
  await expect(page.getByRole('combobox', { name: 'Тип объекта', exact: true })).toHaveText('Элитная квартира');
  await expect(page.getByTestId('property-photos').locator('.property-photo-card')).toHaveCount(2);
  state.item.price = 7100000;
  await page.getByRole('checkbox', { name: 'На главной', exact: true }).check();
  await page.getByRole('button', { name: 'Сохранить объект', exact: true }).click();
  await expect(page.getByLabel('Цена, ₽ (пусто — по запросу)', { exact: true })).toHaveValue('7100000');
  expect(state.updates[1].changedFields).toEqual(['featured']);
  expect(state.galleries).toHaveLength(0);
  await page.getByLabel('Описание фото 1', { exact: true }).fill('Новая подпись');
  await page.getByRole('button', { name: 'Сохранить объект', exact: true }).click();
  await expect.poll(() => state.galleries.length).toBe(1);
  expect(state.galleries[0]).toEqual([{ id: 'photo-one', alt: 'Новая подпись' }, { id: 'photo-two', alt: 'Фото из другой вкладки' }]);
});

test('editing while a save is pending keeps the new input dirty for the next save', async ({ page }) => {
  const state = await editor(page);
  state.delayNext = true;
  await page.getByLabel('Описание', { exact: true }).fill('Первый вариант');
  await page.getByRole('button', { name: 'Сохранить объект', exact: true }).click();
  await expect.poll(() => state.updates.length).toBe(1);
  await page.getByLabel('Описание', { exact: true }).fill('Правка во время сохранения');
  state.release();
  await expect(page.getByText('Объект сохранён.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Описание', { exact: true })).toHaveValue('Правка во время сохранения');
  await page.getByRole('button', { name: 'Сохранить объект', exact: true }).click();
  await expect.poll(() => state.updates.length).toBe(2);
  expect(state.updates[1].changedFields).toEqual(['description']);
  expect(state.item.description).toBe('Правка во время сохранения');
});
