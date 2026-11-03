import { test, expect, type Page } from '@playwright/test';

async function openList(page: Page, section: 'Заявки' | 'Блог') {
  const leads = [
    { id: 'one', name: 'Анна', phone: '+79001111111', comment: 'Квартира у моря', status: 'new', property: { title: 'ЖК Северный' } },
    { id: 'two', name: 'Борис', phone: '+79002222222', comment: 'Срочно', status: 'in_progress', property: null },
    { id: 'three', name: 'Вера', phone: '+79003333333', comment: '', status: 'done', property: null },
  ].map(lead => ({ ...lead, createdAt: '2026-11-03T12:00:00.000Z' }));
  const articles = [
    { id: 'one', title: 'Покупка квартиры', slug: 'buy-flat', published: true, content: 'Семейная ипотека и документы.' },
    { id: 'two', title: 'Выбор района', slug: 'district', published: true, content: 'Удобная транспортная доступность.' },
    { id: 'three', title: 'Будущая статья', slug: 'future', published: false, content: 'План будущей публикации.' },
  ].map(article => ({ ...article, excerpt: 'Анонс статьи о недвижимости', seoTitle: '', seoDescription: '', image: '', publishedAt: null, updatedAt: '2026-11-03T12:00:00.000Z' }));
  await page.route('**/api/admin/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/admin/login' || path === '/api/admin/me') {
      await route.fulfill({ json: { id: 'fixture-admin', email: 'fixture@example.com' } });
    } else if (route.request().method() === 'GET' && path === '/api/admin/leads') {
      await route.fulfill({ json: leads });
    } else if (route.request().method() === 'GET' && path === '/api/admin/articles') {
      await route.fulfill({ json: articles });
    } else if (path === '/api/admin/properties' || path === '/api/admin/import-jobs') {
      await route.fulfill({ json: [] });
    } else {
      throw new Error(`Unexpected request: ${route.request().method()} ${path}`);
    }
  });
  await page.goto('/admin-console-9Xk6uiIs/login');
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__);
  await page.getByLabel('Email', { exact: true }).fill('test@example.com');
  await page.getByLabel('Пароль', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ЖК и квартиры', exact: true })).toBeVisible();
  await page.locator('.admin-navigation').getByRole('link', { name: section, exact: true }).click();
  await page.locator('.admin-exclusions > summary').click();
}

async function exclude(page: Page, field: string, value: string) {
  await page.getByRole('combobox', { name: `Исключить: ${field}`, exact: true }).click();
  await page.getByRole('option', { name: value, exact: true }).click();
}

test('lead exclusions combine with status, match text and reset without changing records', async ({ page }) => {
  await openList(page, 'Заявки');
  const rows = page.locator('.admin-table tbody tr');
  await expect(rows).toHaveCount(3);
  await exclude(page, 'Статус заявки', 'Завершена');
  await expect(rows).toHaveCount(2);
  await page.getByRole('combobox', { name: 'Фильтр заявок', exact: true }).click();
  await page.getByRole('option', { name: 'Новая', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Анна');
  await page.getByRole('textbox', { name: 'Исключить по тексту' }).fill('СЕВЕРНЫЙ');
  await expect(rows).toContainText('По выбранным фильтрам заявки не найдены.');
  await page.getByRole('button', { name: 'Сбросить исключения', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Анна');
  await page.getByRole('combobox', { name: 'Фильтр заявок', exact: true }).click();
  await page.getByRole('option', { name: 'Все заявки', exact: true }).click();
  await expect(rows).toHaveCount(3);
  await page.getByRole('textbox', { name: 'Исключить по тексту' }).fill('79001111111;срочно\nВера');
  await expect(rows).toContainText('По выбранным фильтрам заявки не найдены.');
  await page.getByRole('button', { name: 'Сбросить исключения', exact: true }).click();
  await expect(rows).toHaveCount(3);
});

test('article exclusions support multiple statuses and content text without affecting the editor', async ({ page }) => {
  await openList(page, 'Блог');
  const rows = page.locator('.admin-table tbody tr');
  await expect(rows).toHaveCount(3);
  await exclude(page, 'Публикация статьи', 'Черновик');
  await expect(rows).toHaveCount(2);
  await page.getByRole('textbox', { name: 'Исключить по тексту' }).fill('семейная ипотека');
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Выбор района');
  await exclude(page, 'Публикация статьи', 'Опубликована');
  await expect(rows).toContainText('По выбранным фильтрам статьи не найдены.');
  await page.getByRole('button', { name: 'Сбросить исключения', exact: true }).click();
  await expect(rows).toHaveCount(3);
  await page.getByRole('button', { name: 'Новая статья', exact: true }).click();
  await expect(page.getByLabel('Заголовок статьи', { exact: true })).toBeVisible();
  await expect(page.locator('.admin-exclusions')).toHaveCount(0);
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(rows).toHaveCount(3);
});
