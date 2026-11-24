import { test, expect } from '@playwright/test';

test('ordinary tags and badges share editing and assignment tools', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  let tags: any[] = [{ id: 'ordinary', name: 'Акция', propertyFeature: null }];
  const tasks: any[] = [], assignments: any[] = [];
  let failSave = false;
  await page.route('**/api/admin/**', async route => {
    const url = new URL(route.request().url()), method = route.request().method();
    if (url.pathname === '/api/admin/me') return route.fulfill({ json: { id: 'fixture-admin' } });
    if (url.pathname === '/api/admin/login') return route.fulfill({ json: { ok: true } });
    if (url.pathname === '/api/admin/properties' || url.pathname === '/api/admin/import-jobs') return route.fulfill({ json: [] });
    if (url.pathname === '/api/admin/tag-targets/properties') return route.fulfill({ json: { items: [{ id: 'property', title: 'Тестовый ЖК', type: 'complex', address: 'Тестовая, 1', location: 'Калининград', images: [] }], total: 1 } });
    if (url.pathname === '/api/admin/tag-targets/articles') return route.fulfill({ json: { items: [{ id: 'article', title: 'Тестовая статья', slug: 'article', image: '' }], total: 1 } });
    if (url.pathname === '/api/admin/tags/relations') {
      const body = route.request().postDataJSON(); assignments.push(body);
      return route.fulfill({ json: { propertyRelationsCreated: body.property_ids.length, articleRelationsCreated: body.article_ids.length, badgesAssigned: body.tag_id === 'badge' ? body.property_ids.length : 0, skippedCount: 0, skipped: { secondary: 0, heatingConflict: 0, clearedGroup: 0, limit: 0 } } });
    }
    if (url.pathname === '/api/admin/tags-tasks') {
      if (method === 'GET') return route.fulfill({ json: tasks });
      const body = route.request().postDataJSON(), task = { id: `task-${tasks.length}`, ...body, tag: tags.find(tag => tag.id === body.tag_id) };
      tasks.push(task); return route.fulfill({ json: task });
    }
    if (url.pathname.endsWith('/run')) return route.fulfill({ json: { matchedCount: 5, assignedCount: 1, badgesAssigned: 1, skippedCount: 4, skipped: { secondary: 1, heatingConflict: 1, clearedGroup: 1, limit: 1 } } });
    if (url.pathname === '/api/admin/tags' && method === 'GET') return route.fulfill({ json: tags });
    if (url.pathname.startsWith('/api/admin/tags')) {
      if (failSave) return route.fulfill({ status: 409, json: {} });
      const body = method === 'DELETE' ? null : route.request().postDataJSON();
      if (method === 'POST') {
        const tag = { id: body.propertyFeature ? 'badge' : 'new-ordinary', ...body, propertyFeature: body.propertyFeature ? { id: 'feature', ...body.propertyFeature } : null };
        tags.push(tag); return route.fulfill({ json: tag });
      }
      if (method === 'PUT') {
        const tag = tags.find(tag => tag.id === url.pathname.split('/').pop());
        tag.name = body.name; if (body.propertyFeature) tag.propertyFeature.name = body.propertyFeature.name;
        return route.fulfill({ json: tag });
      }
      if (method === 'DELETE') { tags = tags.filter(tag => tag.id !== url.pathname.split('/').pop()); return route.fulfill({ json: { ok: true } }); }
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto('/admin-console-9Xk6uiIs/login');
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as Element & { __vue_app__?: unknown })?.__vue_app__);
  await page.getByRole('button', { name: 'Только необходимые', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill('fixture@example.com');
  await page.getByLabel('Пароль', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('link', { name: 'Теги и значки', exact: true }).click();
  const directory = page.getByRole('region', { name: 'Справочник тегов и значков', exact: true });
  await expect(page.getByRole('link', { name: 'Преимущества', exact: true })).toHaveCount(0);
  await directory.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Тип тега', exact: true })).toHaveText('Обычный тег');
  await page.getByLabel('Название тега', { exact: true }).fill('Подборка');
  await directory.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(directory.getByRole('row').filter({ hasText: 'Подборка' })).toContainText('Обычный тег');
  await directory.getByRole('button', { name: 'Создать', exact: true }).click();
  await page.getByRole('combobox', { name: 'Тип тега', exact: true }).click();
  await page.getByRole('option', { name: 'Значок · Другие значки', exact: true }).click();
  await page.getByLabel('Название тега', { exact: true }).fill('Подземный паркинг');
  await expect(page.getByLabel('Текст значка на сайте', { exact: true })).toHaveValue('Подземный паркинг');
  await directory.getByRole('button', { name: 'Сохранить', exact: true }).click();
  const badge = directory.getByRole('row').filter({ has: page.getByRole('cell', { name: 'badge', exact: true }) });
  await expect(badge).toContainText('Значок · Другие значки');
  await badge.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await page.getByLabel('Текст значка на сайте', { exact: true }).fill('Паркинг для жителей');
  failSave = true;
  await badge.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(directory.getByRole('status')).toContainText('уже существует');
  await expect(page.getByLabel('Текст значка на сайте', { exact: true })).toHaveValue('Паркинг для жителей');
  failSave = false;
  await badge.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(badge).toContainText('На сайте: Паркинг для жителей');

  for (const [tagName, tagId] of [['Акция', 'ordinary'], ['Подземный паркинг', 'badge']]) {
    await page.getByRole('button', { name: 'Открыть список тегов для ручного назначения', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: new RegExp(`^${tagName}`) }).click();
    await page.getByRole('button', { name: tagId === 'ordinary' ? 'Выбрать объекты и статьи' : 'Выбрать объекты', exact: true }).click();
    const picker = page.getByRole('dialog');
    await picker.getByRole('checkbox', { name: 'Выбрать объект «Тестовый ЖК»', exact: true }).check();
    if (tagId === 'ordinary') {
      await picker.getByRole('button', { name: 'Статьи', exact: true }).click();
      await picker.getByRole('checkbox', { name: 'Выбрать статью «Тестовая статья»', exact: true }).check();
    } else await expect(picker.getByRole('button', { name: 'Статьи', exact: true })).toHaveCount(0);
    await picker.getByRole('button', { name: 'ОК', exact: true }).click();
    await page.getByRole('button', { name: 'Применить', exact: true }).click();
    await expect.poll(() => assignments.some(value => value.tag_id === tagId)).toBe(true);
  }
  expect(assignments[0]).toMatchObject({ property_ids: ['property'], article_ids: ['article'] });
  expect(assignments[1]).toMatchObject({ property_ids: ['property'], article_ids: [] });
  await expect(page.getByRole('status').filter({ hasText: 'Значки обновлены' })).toContainText('Значки обновлены у объектов: 1');
  await page.getByRole('button', { name: 'Открыть список тегов', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^Подземный паркинг/ }).click();
  await page.getByRole('combobox', { name: 'Тип задания', exact: true }).click();
  await expect(page.getByRole('option', { name: 'Статья', exact: true })).toHaveCount(0);
  await page.getByRole('option', { name: 'ЖК', exact: true }).click();
  await page.getByLabel('Значение параметра 1', { exact: true }).fill('Тестовый');
  await page.getByRole('button', { name: 'Создать задание', exact: true }).click();
  await expect.poll(() => tasks.length).toBe(1);
  await page.getByRole('button', { name: 'Запустить', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Задание выполнено' })).toContainText('другое отопление — 1; группа очищена вручную — 1');
  await expect(page.getByRole('status').filter({ hasText: 'Задание выполнено' })).toContainText('достигнут лимит 200 значков — 1');
  await page.getByRole('button', { name: 'Открыть список тегов', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^Акция/ }).click();
  await page.getByRole('combobox', { name: 'Тип задания', exact: true }).click();
  await page.getByRole('option', { name: 'Статья', exact: true }).click();
  await page.getByLabel('Значение параметра 1', { exact: true }).fill('Тестовая');
  await page.getByRole('button', { name: 'Создать задание', exact: true }).click();
  await expect.poll(() => tasks.length).toBe(2);
  expect(tasks[1]).toMatchObject({ type: 'article', tag_id: 'ordinary' });
  await page.screenshot({ path: testInfo.outputPath('tags-badges-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect.poll(() => directory.locator('.admin-table-wrap').evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await expect.poll(() => badge.locator('td').nth(1).evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(220);
  await expect(badge.getByRole('button', { name: 'Редактировать', exact: true })).toHaveCSS('white-space', 'nowrap');
  await expect.poll(() => badge.getByRole('button', { name: 'Редактировать', exact: true }).evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(90);
  await page.screenshot({ path: testInfo.outputPath('tags-badges-mobile.png'), fullPage: true });
  page.once('dialog', dialog => dialog.dismiss());
  await badge.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(badge).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await badge.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(badge).toHaveCount(0);
  expect(tags.some(tag => tag.id === 'ordinary' && !tag.propertyFeature)).toBe(true);
});
