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
  await expect(page.getByText('Данные для подключения ИИ-агента или другого клиента API.', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Возможности API', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Что доступно по API', exact: true })).toHaveCount(0);
  expect(reveals).toBe(0);
  expect(await page.content()).not.toContain(token);
  await page.getByRole('button', { name: 'Показать ключ', exact: true }).click();
  await expect(page.getByLabel('Ключ API', { exact: true })).toHaveValue(token);
  expect(reveals).toBe(1);
  await page.getByRole('button', { name: 'Скрыть ключ', exact: true }).click();
  await expect(page.getByLabel('Ключ API', { exact: true })).not.toHaveValue(token);
  expect(await page.content()).not.toContain(token);
});
