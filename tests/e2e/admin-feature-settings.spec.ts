import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/admin-console-9Xk6uiIs/login');
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as Element & { __vue_app__?: unknown })?.__vue_app__);
  await page.getByRole('button', { name: 'Только необходимые', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill('fixture@example.com');
  await page.getByLabel('Пароль', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ЖК и квартиры', exact: true })).toBeVisible();
}

test('admin manages advantage dictionary and confirms removal on mobile', async ({ page }, testInfo) => {
  let features = [{ id: 'location-sea', name: 'У моря', group: 'location' }];
  let failSave = false;
  await page.route('**/api/admin/**', async route => {
    const url = new URL(route.request().url()), method = route.request().method();
    if (url.pathname === '/api/admin/me') return route.fulfill({ json: { id: 'fixture-admin' } });
    if (url.pathname === '/api/admin/login') return route.fulfill({ json: { ok: true } });
    if (url.pathname === '/api/admin/properties' || url.pathname === '/api/admin/import-jobs') return route.fulfill({ json: [] });
    if (url.pathname === '/api/admin/property-features' && method === 'GET') return route.fulfill({ json: features });
    if (url.pathname.startsWith('/api/admin/property-features')) {
      if (failSave) return route.fulfill({ status: 409, json: { data: { message: 'Такое преимущество уже существует.' } } });
      if (method === 'POST') {
        const feature = { id: 'parking', ...route.request().postDataJSON() };
        features.push(feature);
        return route.fulfill({ json: feature });
      }
      const id = url.pathname.split('/').pop();
      if (method === 'PUT') {
        const feature = features.find(item => item.id === id)!;
        Object.assign(feature, route.request().postDataJSON());
        return route.fulfill({ json: feature });
      }
      if (method === 'DELETE') {
        features = features.filter(item => item.id !== id);
        return route.fulfill({ json: { ok: true } });
      }
    }
    return route.fulfill({ status: 404, json: { message: 'Unexpected fixture request' } });
  });
  await login(page);
  await page.getByRole('link', { name: 'Преимущества', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Преимущества объектов', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Название преимущества', exact: true }).fill('Подземный паркинг');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  const other = page.getByRole('region', { name: 'Другие преимущества', exact: true });
  await expect(other).toContainText('Подземный паркинг');
  expect(features.find(item => item.id === 'parking')?.group).toBe('other');

  await page.getByRole('button', { name: 'Переименовать: Подземный паркинг', exact: true }).click();
  await page.getByRole('textbox', { name: 'Новое название', exact: true }).fill('Паркинг для жителей');
  failSave = true;
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Такое преимущество уже существует.');
  await expect(page.getByRole('textbox', { name: 'Новое название', exact: true })).toHaveValue('Паркинг для жителей');
  failSave = false;
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(other).toContainText('Паркинг для жителей');
  await page.screenshot({ path: testInfo.outputPath('feature-dictionary-desktop.png'), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('feature-dictionary-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Удалить: Паркинг для жителей', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('всех объектов');
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(other).toContainText('Паркинг для жителей');
  await page.getByRole('button', { name: 'Удалить: Паркинг для жителей', exact: true }).click();
  await dialog.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(other).not.toContainText('Паркинг для жителей');
  expect(features.map(item => item.id)).toEqual(['location-sea']);
});

test('API connection keeps the key masked until explicitly revealed', async ({ page }) => {
  const token = 'fixture-api-token-0123456789abcdef';
  let reveals = 0;
  await page.route('**/api/admin/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/admin/me') return route.fulfill({ json: { id: 'fixture-admin' } });
    if (url.pathname === '/api/admin/login') return route.fulfill({ json: { ok: true } });
    if (url.pathname === '/api/admin/properties' || url.pathname === '/api/admin/import-jobs') return route.fulfill({ json: [] });
    if (url.pathname === '/api/admin/agent-connection') {
      const reveal = url.searchParams.get('reveal') === '1';
      if (reveal) reveals++;
      return route.fulfill({ json: { enabled: true, token: reveal ? token : null } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await login(page);
  await page.getByRole('link', { name: 'Подключение по API', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Подключение по API', exact: true })).toBeVisible();
  expect(reveals).toBe(0);
  expect(await page.content()).not.toContain(token);
  await page.getByRole('button', { name: 'Показать ключ', exact: true }).click();
  await expect(page.getByLabel('Ключ API', { exact: true })).toHaveValue(token);
  expect(reveals).toBe(1);
  await page.getByRole('button', { name: 'Скрыть ключ', exact: true }).click();
  await expect(page.getByLabel('Ключ API', { exact: true })).not.toHaveValue(token);
  expect(await page.content()).not.toContain(token);
});
