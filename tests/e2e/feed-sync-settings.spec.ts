import { test, expect, type Page } from '@playwright/test';
import type { FeedSyncSettings } from '../../shared/feed-sync';

async function settingsPage(page: Page, initiallyActive = false) {
  let settings: FeedSyncSettings = {
    url: 'https://feed.rf39.ru/30.xml', enabled: false, intervalMinutes: 60,
    nextRunAt: null, lastSuccessAt: null, lastError: null,
    lastJobId: initiallyActive ? 'sync-one' : null, activeJobId: initiallyActive ? 'sync-one' : null,
  };
  const saves: unknown[] = [], runs: { requestId: string }[] = [];
  let job = {
    id: 'sync-one', kind: 'sync', source: 'rf39', title: 'Синхронизация XML CRM RF39', status: 'queued',
    createdAt: '2026-11-03T12:00:00.000Z', updatedAt: '2026-11-03T12:00:00.000Z', finishedAt: null as string | null,
    stopRequested: false, total: 2, processed: 0, created: 0, linked: 0, existing: 0, failed: 0,
    activeTitle: '', error: null, canRetry: false, items: [],
  };
  await page.route('**/api/admin/**', async route => {
    const path = new URL(route.request().url()).pathname, method = route.request().method();
    if (path === '/api/admin/login' || path === '/api/admin/me')
      return route.fulfill({ json: { id: 'fixture-admin', email: 'fixture@example.com' } });
    if (path === '/api/admin/feed-sync') {
      if (method === 'PUT') {
        const body = route.request().postDataJSON();
        saves.push(body);
        settings = { ...settings, ...body, nextRunAt: body.enabled ? '2026-11-03T13:00:00.000Z' : null };
      }
      return route.fulfill({ json: settings });
    }
    if (path === '/api/admin/feed-sync/run') {
      runs.push(route.request().postDataJSON());
      if (runs.length === 1) return route.fulfill({ status: 503, json: { data: { message: 'Временная ошибка. Повторите запуск.' } } });
      settings = { ...settings, lastJobId: job.id, activeJobId: job.id };
      return route.fulfill({ json: job });
    }
    if (path === '/api/admin/import-jobs') return route.fulfill({ json: settings.lastJobId ? [job] : [] });
    if (path === '/api/admin/import-jobs/sync-one') return route.fulfill({ json: job });
    if (path === '/api/admin/import-jobs/sync-one/stop') {
      job = { ...job, status: 'stopped', finishedAt: '2026-11-03T12:01:00.000Z', updatedAt: '2026-11-03T12:01:00.000Z' };
      settings.activeJobId = null;
      return route.fulfill({ json: job });
    }
    if (path === '/api/admin/properties') return route.fulfill({ json: [] });
    throw new Error(`Unexpected request: ${method} ${path}`);
  });
  await page.goto('/admin-console-9Xk6uiIs/login');
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__);
  await page.getByLabel('Email', { exact: true }).fill('test@example.com');
  await page.getByLabel('Пароль', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ЖК и квартиры', exact: true })).toBeVisible();
  await page.locator('.admin-navigation').getByRole('link', { name: 'XML-выгрузка', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'XML-выгрузка CRM RF39', exact: true })).toBeVisible();
  return { saves, runs };
}

test('XML sync settings validate, save and retry one manual job without duplicates', async ({ page }) => {
  const { saves, runs } = await settingsPage(page);
  await expect(page.getByRole('checkbox', { name: 'Автоматически обновлять по расписанию' })).not.toBeChecked();
  await page.getByLabel('Ссылка XML', { exact: true }).fill('https://example.com/30.xml');
  await page.getByRole('button', { name: 'Сохранить настройки', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Укажите ссылку');
  expect(saves).toHaveLength(0);
  await page.getByLabel('Ссылка XML', { exact: true }).fill('https://feed.rf39.ru/31.xml');
  await page.getByLabel('Интервал обновления, минут', { exact: true }).fill('120');
  await page.getByRole('checkbox', { name: 'Автоматически обновлять по расписанию' }).check();
  await expect(page.getByRole('button', { name: 'Синхронизировать сейчас', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Сохранить настройки', exact: true }).click();
  await expect(page.getByText('Настройки сохранены. Автоматическая синхронизация включена.', { exact: true })).toBeVisible();
  expect(saves).toEqual([{ url: 'https://feed.rf39.ru/31.xml', enabled: true, intervalMinutes: 120 }]);
  await page.getByRole('button', { name: 'Синхронизировать сейчас', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Временная ошибка');
  await page.getByRole('button', { name: 'Синхронизировать сейчас', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Синхронизация выполняется…', exact: true })).toBeDisabled();
  expect(runs).toHaveLength(2);
  expect(runs[0].requestId).toBe(runs[1].requestId);
  await page.locator('.feed-settings .job-progress').getByRole('button', { name: 'Остановить', exact: true }).click();
  await expect(page.locator('.feed-settings .job-progress')).toContainText('Остановлено');
});

test('XML sync settings restore an active task and preserve form state across status refresh', async ({ page }, testInfo) => {
  const { runs } = await settingsPage(page, true);
  await expect(page.getByRole('button', { name: 'Синхронизация выполняется…', exact: true })).toBeDisabled();
  await expect(page.locator('.feed-settings .job-progress')).toContainText('Синхронизация XML CRM RF39');
  await page.getByLabel('Интервал обновления, минут', { exact: true }).fill('180');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('xml-settings-390.png'), fullPage: true });
  await page.locator('.feed-settings .job-progress').getByRole('button', { name: 'Остановить', exact: true }).click();
  await expect(page.locator('.feed-settings .job-progress')).toContainText('Остановлено');
  await expect(page.getByLabel('Интервал обновления, минут', { exact: true })).toHaveValue('180');
  expect(runs).toHaveLength(0);
});
