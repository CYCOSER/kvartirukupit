import { test, expect, type Page } from '@playwright/test';
import { mockImportJobs } from './fixtures/import-jobs';

const complex = {
  id: 'fixture-complex', title: 'ЖК для проверки поиска', slug: 'fixture-complex', type: 'complex',
  location: 'Калининград', address: 'Тестовый адрес', price: null, status: 'available', area: null,
  landArea: null, bedrooms: null, floors: null, latitude: null, longitude: null, readiness: 'Готов', finish: 'Чистовая',
  seaDistance: null, description: '', utilities: [], published: false, featured: false, elite: false, demo: false,
  sourceId: null, images: [], apartments: [],
};

async function editorFixture(page: Page) {
  const state = { mappings: {} as Record<string, string>, saved: {} as Record<string, unknown>, directSearches: 0 };
  await page.route('**/api/admin/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/admin/me' || path === '/api/admin/login')
      await route.fulfill({ json: { id: 'fixture-admin', email: 'fixture@example.com' } });
    else if (path === '/api/admin/properties') await route.fulfill({ json: [complex] });
    else if (path === `/api/admin/properties/${complex.id}`) {
      if (route.request().method() === 'PUT') state.saved = route.request().postDataJSON();
      await route.fulfill({ json: { ...complex, ...state.mappings } });
    } else if (path === `/api/admin/properties/${complex.id}/images`) await route.fulfill({ json: [] });
    else {
      if (path.endsWith('/find-apartments') || path.endsWith('/import')) state.directSearches++;
      await route.fulfill({ status: 404, json: { message: 'Unexpected fixture request' } });
    }
  });
  return state;
}

async function openEditor(page: Page) {
  await page.goto('/admin-console-9Xk6uiIs/login');
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__);
  await page.getByLabel('Email', { exact: true }).fill('fixture@example.com');
  await page.getByLabel('Пароль', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('link', { name: complex.title, exact: true }).click();
  await expect(page.getByTestId('complex-apartment-search')).toBeVisible();
}

test('single complex queues saved source preference and refreshes mappings without overwriting editor input', async ({ page }) => {
  const state = await editorFixture(page);
  const fixture = await mockImportJobs(page, { create: (_request, job) => {
    state.mappings = { rf39ComplexId: 'discovered-development', rf39BuildingId: 'discovered-building' };
    Object.assign(job, { status: 'completed', total: 2, processed: 2, created: 1, failed: 1, canRetry: true,
      items: [
        { id: 'search-failed', kind: 'search', title: 'Нмаркет', source: 'nmarket', complexId: complex.id,
          status: 'failed', created: false, linked: false, warnings: [], error: 'Выгрузка недоступна' },
        { id: 'import-ok', kind: 'import', title: 'Квартира из CRM', source: 'rf39', sourceId: 11, complexId: complex.id,
          status: 'completed', created: true, linked: true, propertyId: 'new-apartment', warnings: [] },
      ],
    });
  } });
  await openEditor(page);
  await page.getByText('Связь с ЖК в Нмаркете и CRM', { exact: true }).click();
  await page.getByLabel('ID корпуса в CRM RF39 (необязательно)', { exact: true }).fill('manual-building');
  const search = page.getByTestId('complex-apartment-search');
  await search.getByRole('combobox', { name: 'Данные Нмаркета и CRM RF39 для поиска квартир', exact: true }).click();
  await page.getByRole('option', { name: 'Сохранённая выгрузка', exact: true }).click();
  await search.getByRole('button', { name: 'CRM RF39', exact: true }).click();
  await search.getByRole('button', { name: 'Найти и привязать квартиры', exact: true }).click();
  await expect(search.locator('.import-progress')).toContainText('Создано: 1');
  await expect(search.getByRole('alert')).toContainText('Выгрузка недоступна');
  expect(fixture.requests).toHaveLength(1);
  expect(fixture.requests[0]).toMatchObject({ kind: 'apartments', complexIds: [complex.id], snapshot: 'saved', preferredSource: 'rf39' });
  expect(fixture.requests[0].requestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(state.directSearches).toBe(0);
  await expect(page.getByLabel('ID ЖК в CRM RF39', { exact: true })).toHaveValue('discovered-development');
  await expect(page.getByLabel('ID корпуса в CRM RF39 (необязательно)', { exact: true })).toHaveValue('manual-building');
  await page.getByRole('button', { name: 'Сохранить объект', exact: true }).click();
  await expect(page.getByText('Объект сохранён.', { exact: true })).toBeVisible();
  expect(state.saved.rf39BuildingId).toBe('manual-building');
  expect(state.saved).not.toHaveProperty('rf39ComplexId');
});

test('apartment search can be stopped from another page and reports in-flight completion', async ({ page }) => {
  await editorFixture(page);
  const fixture = await mockImportJobs(page, { create: (_request, job) => {
    Object.assign(job, { status: 'running', total: 3, activeTitle: 'Квартира 31' });
  } });
  await openEditor(page);
  await page.getByRole('button', { name: 'Найти и привязать квартиры', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Поиск выполняется…', exact: true })).toBeDisabled();
  await page.getByRole('link', { name: 'На сайт', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  const panel = page.getByRole('complementary', { name: 'Фоновые задачи' });
  await panel.locator('.jobs-entry > summary').click();
  await panel.getByRole('button', { name: 'Остановить', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Останавливаем…', exact: true })).toBeDisabled();
  expect(fixture.stops).toEqual([fixture.jobs[0].id]);
  Object.assign(fixture.jobs[0], { status: 'stopped', processed: 1, created: 1, linked: 1,
    updatedAt: new Date().toISOString(), activeTitle: '', canRetry: true });
  await expect(panel.locator('.import-progress')).toContainText('Обработано: 1 из 3');
  await expect(panel.locator('.import-progress')).toContainText('Создано: 1');
  await expect(panel.locator('.job-heading')).toContainText('Остановлено');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
