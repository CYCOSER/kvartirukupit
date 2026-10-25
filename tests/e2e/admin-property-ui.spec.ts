import { test, expect } from '@playwright/test';

test('property status cards keep keyboard semantics and the Russian photo picker supports multiple files', async ({ page }, testInfo) => {
  const item = {
    id: 'property-ui-fixture', title: 'Квартира для проверки интерфейса', slug: 'property-ui-fixture', type: 'apartment',
    location: 'Калининград', address: 'Тестовый адрес', price: 6000000, status: 'available',
    area: 45, landArea: null, bedrooms: 1, floors: 5, latitude: null, longitude: null,
    readiness: 'Готов', finish: 'Чистовая', seaDistance: null, description: '', utilities: [],
    published: false, featured: false, elite: false, demo: false, sourceId: 'nmarket:apartment:fixture',
    images: [
      { id: 'photo-one', file: '/images/baltic-coast.webp', alt: 'Первое фото', order: 0, kind: 'photo' },
      { id: 'photo-two', file: '/images/baltic-terrace.webp', alt: 'Второе фото', order: 1, kind: 'photo' },
    ],
  };
  let saved: Record<string, unknown> | undefined;
  let uploads = 0;
  const uploadNames: string[] = [];
  // Browser fixtures isolate the editor UI from real catalog records and credentials.
  await page.route('**/api/admin/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/admin/login' || url.pathname === '/api/admin/me') {
      await route.fulfill({ json: { ok: true } });
    } else if (url.pathname === '/api/admin/properties') {
      await route.fulfill({ json: url.searchParams.has('type') ? [] : [item] });
    } else if (url.pathname === '/api/admin/properties/' + item.id) {
      if (route.request().method() === 'PUT') saved = route.request().postDataJSON();
      await route.fulfill({ json: { ...item, ...saved } });
    } else if (url.pathname === `/api/admin/properties/${item.id}/images`) {
      if (route.request().method() === 'POST') {
        uploads++;
        const body = route.request().postDataBuffer()!.toString('latin1');
        uploadNames.push(body.match(/filename="([^"]+)"/)?.[1] || '');
        await route.fulfill({ json: { id: 'uploaded-' + uploads, file: '/images/journal-morning.webp', alt: 'Загруженное фото ' + uploads, order: uploads + 1, kind: 'photo' } });
      } else await route.fulfill({ json: { ok: true } });
    } else await route.fulfill({ status: 404, json: { message: 'Unexpected fixture request' } });
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/morskoy-kabinet-7q4x/login');
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__);
  await page.getByLabel('Email', { exact: true }).fill('fixture@example.com');
  await page.getByLabel('Пароль', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('link', { name: item.title, exact: true }).click();
  const options = page.getByTestId('property-options');
  const published = page.getByRole('checkbox', { name: 'Опубликован', exact: true });
  await published.focus();
  await page.keyboard.press('Space');
  await expect(published).toBeChecked();
  for (const name of ['На главной', 'Демонстрационный объект']) {
    await page.getByRole('checkbox', { name, exact: true }).check();
  }
  await page.getByRole('combobox', { name: 'Тип объекта', exact: true }).click();
  await page.getByRole('option', { name: 'Элитная квартира', exact: true }).click();
  await expect(options.locator('.property-option.is-selected')).toHaveCount(3);
  const media = page.getByTestId('property-photos');
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Добавить фотографии', exact: true }).click();
  const chooser = await chooserPromise;
  expect(chooser.isMultiple()).toBe(true);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
  await chooser.setFiles([
    { name: 'one.png', mimeType: 'image/png', buffer: png },
    { name: 'two.png', mimeType: 'image/png', buffer: png },
  ]);
  await expect(media.locator('.property-photo-card')).toHaveCount(4);
  expect(uploadNames).toEqual(['one.png', 'two.png']);
  await expect(media.getByLabel('Количество фотографий')).toHaveText('4 / 100');
  await expect(page.getByLabel('Файлы фотографий', { exact: true })).toBeHidden();
  await expect(media).not.toContainText('Choose Files');
  await page.getByRole('button', { name: 'Сохранить объект', exact: true }).click();
  await expect(page.getByText('Объект сохранён.', { exact: true })).toBeVisible();
  expect(saved).toMatchObject({ published: true, featured: true, demo: true, elite: true, type: 'apartment' });

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1800 });
    const card = media.locator('.property-photo-card').first();
    const photo = await card.locator('img').boundingBox();
    const alt = await card.getByRole('textbox').boundingBox();
    const remove = await card.getByRole('button', { name: 'Убрать', exact: true }).boundingBox();
    const editor = await card.getByRole('button', { name: 'Редактировать фото: Первое фото', exact: true }).boundingBox();
    expect(editor!.y).toBeGreaterThanOrEqual(photo!.y + photo!.height);
    expect(editor!.y).toBeGreaterThanOrEqual(alt!.y + alt!.height);
    expect(editor!.x).toBeGreaterThanOrEqual(remove!.x + remove!.width - 1);
    expect(editor!.y).toBeCloseTo(remove!.y, 0);
    expect(editor!.height).toBeCloseTo(remove!.height, 0);
    const overflow = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      elements: [...document.querySelectorAll('*')].flatMap((element) => {
        const rect = element.getBoundingClientRect();
        return rect.right > document.documentElement.clientWidth + 1
          ? [{ tag: element.tagName, class: element.className, right: rect.right, width: rect.width }]
          : [];
      }),
    }));
    expect(overflow.scrollWidth, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width);
    await options.screenshot({ path: testInfo.outputPath(`property-options-${width}.png`) });
    await media.screenshot({ path: testInfo.outputPath(`property-photos-${width}.png`) });
  }
});
