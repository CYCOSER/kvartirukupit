import { expect, type Route } from '@playwright/test';
import { test } from './fixtures/admin-session';
import { jobFixture, mockImportJobs } from './fixtures/import-jobs';

for (const source of ['rf39', 'nmarket'] as const) test(`${source} job survives reload and closing its page, with stop available after reopening`, async ({ page, context }) => {
  const fixture = await mockImportJobs(context, { create: (_request, job) => {
    Object.assign(job, { status: 'running', activeTitle: 'Первый черновик' });
  } });
  await context.route(`**/api/admin/${source}/objects?*`, route => route.fulfill({ json: {
    items: [1, 2].map(id => ({ id: source === 'rf39' ? id : `apartment:${id}`, title: `Черновик ${id}`,
      category: 'Квартиры', location: 'Калининград', address: '', price: null, area: null, supported: true, existingId: null })), nextOffset: null,
  } }));
  await page.goto(`/admin-console-9Xk6uiIs/properties/import?source=${source}`);
  await page.getByRole('button', { name: 'Выбрать все найденные', exact: true }).click();
  await page.getByRole('button', { name: 'Создать черновики (2)', exact: true }).click();
  await expect(page.locator('.import-page .import-progress')).toContainText('Обработано: 0 из 2');
  await page.reload();
  await expect(page.locator('.import-page .import-progress')).toContainText('Обработано: 0 из 2');
  expect(fixture.requests).toHaveLength(1);
  expect(fixture.stops).toHaveLength(0);
  await page.close();
  Object.assign(fixture.jobs[0], { processed: 1, created: 1, activeTitle: 'Второй черновик', updatedAt: new Date().toISOString() });
  const reopened = await context.newPage();
  await reopened.goto('/admin-console-9Xk6uiIs/leads');
  const panel = reopened.getByRole('complementary', { name: 'Фоновые задачи' });
  await panel.getByRole('button', { name: /Создание черновиков/ }).click();
  await panel.locator('.jobs-entry > summary').click();
  await expect(panel.locator('.import-progress')).toContainText('Обработано: 1 из 2');
  expect(fixture.stops).toHaveLength(0);
  await panel.getByRole('button', { name: 'Остановить', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Останавливаем…', exact: true })).toBeDisabled();
  expect(fixture.stops).toEqual([fixture.jobs[0].id]);
  expect(fixture.requests).toHaveLength(1);
  await reopened.close();
});

test('old jobs can be removed without reviving cached results; active jobs stay protected', async ({ page, context }, testInfo) => {
  const fixture = await mockImportJobs(context);
  const completed = jobFixture({ requestId: 'history-1', kind: 'import', source: 'nmarket', items: [{ id: 'apartment:1' }] }, 1);
  Object.assign(completed, { status: 'completed', processed: 1, created: 1, items: [{
    id: 'receipt-1', kind: 'import', title: 'Сохранённая квартира', source: 'nmarket', sourceId: 'apartment:1',
    propertyId: 'kept-draft', status: 'completed', created: true, linked: false, warnings: [],
  }] });
  const stopped = jobFixture({ requestId: 'history-2', kind: 'import', source: 'rf39', items: [{ id: 2 }] }, 2);
  Object.assign(stopped, { status: 'stopped', canRetry: true });
  const running = jobFixture({ requestId: 'history-3', kind: 'import', source: 'rf39', items: [{ id: 3 }] }, 3);
  running.status = 'running';
  fixture.jobs.push(completed, stopped, running);
  await context.route('**/api/admin/nmarket/objects?*', route => route.fulfill({ json: {
    items: [{ id: 'apartment:1', title: 'Сохранённая квартира', category: 'Квартиры', location: 'Калининград',
      address: '', price: null, supported: true, existingId: 'kept-draft' }], nextOffset: null,
  } }));
  await page.goto('/admin-console-9Xk6uiIs/properties/import?source=nmarket');
  await expect(page.locator('.import-page .import-results')).toHaveCount(1);
  const panel = page.getByRole('complementary', { name: 'Фоновые задачи' });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator('.import-selection').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`history-spacing-${width}.png`) });
    await panel.getByRole('button', { name: /Создание черновиков/ }).click();
    await panel.screenshot({ path: testInfo.outputPath(`history-controls-${width}.png`) });
    await panel.getByRole('button', { name: /Создание черновиков/ }).click();
  }
  await panel.getByRole('button', { name: /Создание черновиков/ }).click();
  await expect(panel.locator(`[data-job-id="${running.id}"] .jobs-remove`)).toHaveCount(0);

  let failDelete = true;
  await context.route(`**/api/admin/import-jobs/${stopped.id}`, async route => {
    if (route.request().method() === 'DELETE' && failDelete) {
      failDelete = false;
      await route.fulfill({ status: 503, json: { data: { message: 'Не удалось удалить задачу.' } } });
    } else await route.fallback();
  });
  const stoppedEntry = panel.locator(`.jobs-entry[data-job-id="${stopped.id}"]`);
  await stoppedEntry.getByRole('button', { name: 'Удалить задачу из истории' }).click();
  await expect(panel.getByRole('alert')).toContainText('Не удалось удалить задачу.');
  await expect(stoppedEntry).toHaveCount(1);
  await stoppedEntry.getByRole('button', { name: 'Удалить задачу из истории' }).click();
  await expect(stoppedEntry).toHaveCount(0);

  let held: Route | undefined;
  let stale = '';
  let heldOnce = false;
  await context.route('**/api/admin/import-jobs', async route => {
    if (route.request().method() === 'GET' && !heldOnce) {
      heldOnce = true;
      stale = JSON.stringify(fixture.jobs.map(({ items, ...job }) => job));
      held = route;
    } else await route.fallback();
  });
  await expect.poll(() => !!held).toBe(true);
  await panel.locator(`.jobs-entry[data-job-id="${completed.id}"]`).getByRole('button', { name: 'Удалить задачу из истории' }).click();
  await expect(page.locator('.import-page .job-progress')).toHaveCount(0);
  const finished = page.waitForEvent('requestfinished', { predicate: request => request.url().endsWith('/api/admin/import-jobs') });
  await held!.fulfill({ contentType: 'application/json', body: stale });
  await finished;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(panel.locator(`.jobs-entry[data-job-id="${completed.id}"]`)).toHaveCount(0);
  await expect(page.locator('.import-page .job-progress')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.import-page .job-progress')).toHaveCount(0);
  await expect(page.locator('.import-page .import-table')).toContainText('Сохранённая квартира');
  expect(fixture.jobs.map(job => job.id)).toEqual([running.id]);
});
