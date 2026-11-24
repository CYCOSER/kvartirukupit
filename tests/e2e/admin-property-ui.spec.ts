import { test, expect, type Page } from '@playwright/test';
import { propertyFixture } from './fixtures/property';
import type { PropertyFeature } from '../../shared/property-feature';

const featureDictionary: PropertyFeature[] = [
  { id: 'heating-gas', name: 'Газовое крышная котельная', group: 'heating' },
  { id: 'heating-central', name: 'Центральное отопление', group: 'heating' },
  { id: 'territory-fence', name: 'Огороженная территория', group: 'territory' },
  { id: 'location-sea', name: 'У моря', group: 'location' },
  { id: 'location-park', name: 'У парка', group: 'location' },
  { id: 'other-pool', name: 'Бассейн', group: 'other' },
];

async function addBadge(page: Page, name: string, query = name) {
  const search = page.getByRole('combobox', { name: 'Поиск значков', exact: true });
  await search.fill(query);
  await expect(page.getByRole('option', { name, exact: true })).toBeVisible();
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(page.getByRole('button', { name: `Убрать значок: ${name}`, exact: true })).toBeVisible();
  await expect(search).toHaveValue('');
  await search.press('Escape');
}

test('badge search keeps large dictionaries and selected chips compact', async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('site-analytics-consent', 'necessary'));
  const dictionary: PropertyFeature[] = Array.from({ length: 240 }, (_, index) => ({ id: `bulk-badge-${index}`, name: `Массовый значок ${index}`, group: 'other' }));
  const item = propertyFixture({ id: 'bulk-badges', slug: 'bulk-badges', title: 'ЖК с большим списком значков', type: 'complex', housingMarket: null, features: dictionary.slice(0, 105), featureOverrides: ['other'] });
  await page.route('**/api/admin/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/admin/me') return route.fulfill({ json: { id: 'fixture-admin' } });
    if (url.pathname === '/api/admin/login') return route.fulfill({ json: { ok: true } });
    if (url.pathname === '/api/admin/import-jobs') return route.fulfill({ json: [] });
    if (url.pathname === '/api/admin/property-features') return route.fulfill({ json: dictionary });
    if (url.pathname === '/api/admin/properties') return route.fulfill({ json: [item] });
    if (url.pathname === `/api/admin/properties/${item.id}`) return route.fulfill({ json: item });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto('/admin-console-9Xk6uiIs/login');
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as Element & { __vue_app__?: unknown })?.__vue_app__);
  await page.getByLabel('Email', { exact: true }).fill('fixture@example.com');
  await page.getByLabel('Пароль', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('link', { name: item.title, exact: true }).click();
  const benefits = page.getByRole('region', { name: 'Значки', exact: true });
  const selected = benefits.locator('.property-feature-selected');
  const search = page.getByRole('combobox', { name: 'Поиск значков', exact: true });
  await expect(selected.getByRole('button', { name: /^Убрать значок:/ })).toHaveCount(105);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1100 });
    await search.scrollIntoViewIfNeeded();
    await expect.poll(() => selected.evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(146);
    await expect.poll(() => selected.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await search.fill('');
    await search.click();
    await search.press('ArrowDown');
    const options = page.locator('.property-feature-options');
    await expect(options.getByRole('option')).toHaveCount(135);
    await expect.poll(() => options.evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(242);
    await expect.poll(() => options.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`badge-picker-${width}.png`) });
    await search.fill('совсем-неизвестный-значок');
    await expect(page.getByRole('option')).toHaveCount(0);
    await expect(page.getByText(/не найден/i)).toBeVisible();
    const unintendedSave = page.waitForRequest(request => request.method() === 'PUT' && new URL(request.url()).pathname === `/api/admin/properties/${item.id}`, { timeout: 500 }).then(() => true, () => false);
    await search.press('Enter');
    expect(await unintendedSave).toBe(false);
    await search.fill('');
    await expect(selected.getByRole('button', { name: /^Убрать значок:/ })).toHaveCount(105);
    await search.press('Escape');
  }
  await addBadge(page, 'Массовый значок 143', 'bulk-badge-143');
  await expect(selected.getByRole('button', { name: /^Убрать значок:/ })).toHaveCount(106);
  const added = page.getByRole('button', { name: 'Убрать значок: Массовый значок 143', exact: true });
  await added.focus();
  await page.keyboard.press('Enter');
  await expect(added).toHaveCount(0);
  await expect(selected.getByRole('button', { name: /^Убрать значок:/ })).toHaveCount(105);
});

test('apartment benefits can inherit, override, clear and restore complex groups', async ({ page }, testInfo) => {
  let dictionary = featureDictionary.map(feature => ({ ...feature }));
  let dictionaryFails = false;
  const complex = propertyFixture({ id: 'benefit-complex', slug: 'benefit-complex', title: 'ЖК с преимуществами', type: 'complex', housingMarket: null, features: featureDictionary.filter(feature => ['heating-gas', 'territory-fence', 'location-sea'].includes(feature.id)) });
  const item = propertyFixture({ id: 'benefit-apartment', slug: 'benefit-apartment', title: 'Квартира с преимуществами', complexId: complex.id, complex });
  const saves: Record<string, unknown>[] = [];
  await page.route('**/api/admin/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/admin/me') return route.fulfill({ json: { id: 'fixture-admin' } });
    if (url.pathname === '/api/admin/login') return route.fulfill({ json: { ok: true } });
    if (url.pathname === '/api/admin/import-jobs') return route.fulfill({ json: [] });
    if (url.pathname === '/api/admin/property-features') return route.fulfill({ status: dictionaryFails ? 500 : 200, json: dictionaryFails ? {} : dictionary });
    if (url.pathname === '/api/admin/properties') return route.fulfill({ json: url.searchParams.has('type') ? [complex] : [item] });
    if (url.pathname === `/api/admin/properties/${item.id}`) {
      if (route.request().method() === 'PUT') {
        const saved = route.request().postDataJSON();
        saves.push(saved);
        Object.assign(item, saved, { features: dictionary.filter(feature => saved.featureIds.includes(feature.id)) });
      }
      return route.fulfill({ json: item });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/admin-console-9Xk6uiIs/login');
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__);
  await page.getByLabel('Email', { exact: true }).fill('fixture@example.com');
  await page.getByLabel('Пароль', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('link', { name: item.title, exact: true }).click();
  const benefits = page.getByRole('region', { name: 'Значки', exact: true });
  const inheritedLocation = page.getByRole('checkbox', { name: 'Использовать от ЖК: Локация', exact: true });
  const sea = page.getByRole('button', { name: 'Убрать значок: У моря', exact: true });
  const park = page.getByRole('button', { name: 'Убрать значок: У парка', exact: true });
  await expect(benefits.getByRole('combobox', { name: 'Поиск значков', exact: true })).toHaveAttribute('placeholder', 'Название или ID значка…');
  await expect(page.getByRole('button', { name: 'Убрать значок: Газовое крышная котельная', exact: true })).toBeVisible();
  await expect(sea).toBeVisible();
  await expect(sea).toBeEnabled();
  await expect(inheritedLocation).toBeHidden();
  await addBadge(page, 'У парка', 'location-park');
  await expect(sea).toBeVisible();
  await sea.focus();
  await page.keyboard.press('Enter');
  await expect(sea).toHaveCount(0);
  await addBadge(page, 'Бассейн');
  await expect(benefits.locator('.property-features')).toContainText('У парка');
  await expect(benefits.locator('.property-features')).toContainText('Бассейн');
  await expect(benefits.locator('.property-features')).not.toContainText('У моря');
  dictionaryFails = true;
  await page.getByRole('button', { name: 'Обновить значки', exact: true }).click();
  await expect(benefits.getByRole('alert')).toContainText('Не удалось загрузить');
  await expect(park).toBeVisible();
  await expect(page.getByRole('button', { name: 'Убрать значок: Бассейн', exact: true })).toBeVisible();
  dictionaryFails = false;
  dictionary.find(feature => feature.id === 'other-pool')!.name = 'Бассейн во дворе';
  await page.getByRole('button', { name: 'Обновить значки', exact: true }).click();
  await expect(benefits.locator('.property-features')).toContainText('Бассейн во дворе');
  await page.getByRole('button', { name: 'Сохранить объект', exact: true }).click();
  await expect(page.getByText('Объект сохранён.', { exact: true })).toBeVisible();
  expect(saves[0]?.featureIds).toEqual(expect.arrayContaining(['location-park', 'other-pool']));
  expect(saves[0]?.featureOverrides).toEqual(expect.arrayContaining(['location', 'other']));
  expect(saves[0]?.featureOverrides).not.toContain('heating');
  await page.getByRole('link', { name: 'ЖК и квартиры', exact: true }).click();
  await page.getByRole('link', { name: item.title, exact: true }).click();
  await expect(park).toBeVisible();
  await expect(inheritedLocation).toBeHidden();
  await benefits.getByText('Наследование от ЖК', { exact: true }).click();
  await expect(inheritedLocation).not.toBeChecked();
  await park.click();
  await page.getByRole('button', { name: 'Сохранить объект', exact: true }).click();
  await expect.poll(() => saves.length).toBe(2);
  expect(saves[1]?.featureIds).not.toContain('location-park');
  expect(saves[1]?.featureOverrides).toContain('location');
  await expect(benefits.locator('.property-features')).not.toContainText('У моря');
  await inheritedLocation.check();
  await expect(sea).toBeVisible();
  await expect(sea).toBeEnabled();
  await page.getByRole('button', { name: 'Сохранить объект', exact: true }).click();
  await expect.poll(() => saves.length).toBe(3);
  expect(saves[2]?.featureOverrides).not.toContain('location');
  expect(saves[2]?.featureIds).not.toContain('location-sea');
  await benefits.getByText('Наследование от ЖК', { exact: true }).click();
  await expect(inheritedLocation).toBeHidden();
  dictionary = dictionary.filter(feature => feature.id !== 'other-pool');
  await page.getByRole('button', { name: 'Обновить значки', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Убрать значок: Бассейн во дворе', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Сохранить объект', exact: true }).click();
  await expect.poll(() => saves.length).toBe(4);
  expect(saves[3]?.featureIds).toEqual([]);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1100 });
    await benefits.scrollIntoViewIfNeeded();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await benefits.screenshot({ path: testInfo.outputPath(`badge-list-${width}.png`) });
  }
});

test('property status cards keep keyboard semantics and the Russian photo picker supports multiple files', async ({ page }, testInfo) => {
  const item = {
    id: 'property-ui-fixture', title: 'Квартира для проверки интерфейса', slug: 'property-ui-fixture', type: 'apartment',
    priority: 4,
    housingMarket: 'newbuild',
    location: 'Калининград', address: 'Тестовый адрес', price: 6000000, status: 'available',
    area: 45, landArea: null, bedrooms: 1, floors: 5, availableFloors: [2, 5], latitude: null, longitude: null,
    readiness: 'Готов', finish: 'Чистовая', seaDistance: null, description: '', utilities: [],
    features: [], featureOverrides: [], developer: 'Застройщик из CRM',
    published: false, featured: false, elite: false, demo: false, sourceId: 'nmarket:apartment:fixture',
    images: [
      { id: 'photo-one', file: '/images/baltic-coast.webp', alt: 'Первое фото', order: 0, kind: 'photo' },
      { id: 'photo-two', file: '/images/baltic-terrace.webp', alt: 'Второе фото', order: 1, kind: 'photo' },
    ],
  };
  let saved: Record<string, unknown> | undefined;
  let uploads = 0;
  let savedImages: { id: string }[] | undefined;
  const uploadNames: string[] = [];
  // Browser fixtures isolate the editor UI from real catalog records and credentials.
  await page.route('**/api/admin/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/admin/login') {
      await route.fulfill({ json: { ok: true } });
    } else if (url.pathname === '/api/admin/me') {
      await route.fulfill({ json: { id: 'admin-ui-fixture' } });
    } else if (url.pathname === '/api/admin/import-jobs') {
      await route.fulfill({ json: [] });
    } else if (url.pathname === '/api/admin/property-features') {
      await route.fulfill({ json: featureDictionary });
    } else if (url.pathname === '/api/admin/properties') {
      await route.fulfill({ json: url.searchParams.has('type') ? [] : [item] });
    } else if (url.pathname === '/api/admin/properties/' + item.id) {
      if (route.request().method() === 'PUT') saved = route.request().postDataJSON();
      await route.fulfill({ json: { ...item, ...saved, features: featureDictionary.filter(feature => (saved?.featureIds as string[] || []).includes(feature.id)) } });
    } else if (url.pathname === `/api/admin/properties/${item.id}/images`) {
      if (route.request().method() === 'POST') {
        uploads++;
        const body = route.request().postDataBuffer()!.toString('latin1');
        const name = body.match(/filename="([^"]+)"/)?.[1] || '';
        uploadNames.push(name);
        if (name === 'duplicate.png') return route.fulfill({ json: { ...item.images[0], duplicate: true } });
        if (name === 'broken.png') return route.fulfill({ status: 400, json: { message: 'Invalid image' } });
        await route.fulfill({ json: { id: 'uploaded-' + uploads, file: '/images/journal-morning.webp', alt: 'Загруженное фото ' + uploads, order: uploads + 1, kind: 'photo' } });
      } else {
        savedImages = route.request().postDataJSON();
        await route.fulfill({ json: { ok: true } });
      }
    } else await route.fulfill({ status: 404, json: { message: 'Unexpected fixture request' } });
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/admin-console-9Xk6uiIs/login');
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__);
  await page.getByLabel('Email', { exact: true }).fill('fixture@example.com');
  await page.getByLabel('Пароль', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('link', { name: item.title, exact: true }).click();
  await expect(page.getByText('Застройщик: ' + item.developer, { exact: true })).toBeVisible();
  const market = page.getByRole('combobox', { name: 'Рынок квартиры', exact: true });
  await expect(market).toHaveText('Новостройка');
  await expect(page.getByRole('textbox', { name: 'Доступные этажи', exact: true })).toHaveValue('2, 5');
  const priority = page.getByRole('combobox', { name: 'Приоритет (10 - высший, 1 - низший)', exact: true });
  await expect(priority).toHaveText('4');
  await priority.click();
  await page.getByRole('option', { name: '10 — высший', exact: true }).click();
  const heating = page.getByRole('button', { name: 'Убрать значок: Газовое крышная котельная', exact: true });
  const otherHeating = page.getByRole('button', { name: 'Убрать значок: Центральное отопление', exact: true });
  const fenced = page.getByRole('button', { name: 'Убрать значок: Огороженная территория', exact: true });
  await addBadge(page, 'Газовое крышная котельная');
  await addBadge(page, 'Центральное отопление');
  await expect(heating).toHaveCount(0);
  await expect(otherHeating).toBeVisible();
  await addBadge(page, 'Газовое крышная котельная');
  await expect(otherHeating).toHaveCount(0);
  await addBadge(page, 'Огороженная территория');
  const seaTag = page.getByRole('button', { name: 'Убрать значок: У моря', exact: true });
  const parkTag = page.getByRole('button', { name: 'Убрать значок: У парка', exact: true });
  await addBadge(page, 'У моря');
  await addBadge(page, 'У парка');
  await page.getByRole('combobox', { name: 'Тип объекта', exact: true }).click();
  await page.getByRole('option', { name: 'Жилой комплекс', exact: true }).click();
  await expect(heating).toBeVisible();
  await expect(fenced).toBeVisible();
  await expect(seaTag).toBeVisible();
  await expect(parkTag).toBeVisible();
  await expect(market).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Доступные этажи', exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Тип объекта', exact: true }).click();
  await page.getByRole('option', { name: 'Квартира', exact: true }).click();
  await expect(market).toHaveText('Не указан');
  await fenced.click();
  await expect(page.getByRole('textbox', { name: 'Доступные этажи', exact: true })).toHaveValue('');
  await page.getByRole('textbox', { name: 'Доступные этажи', exact: true }).fill('5, 2, 5');
  await market.click();
  await page.getByRole('option', { name: 'Вторичка', exact: true }).click();
  await expect(heating).toHaveCount(0);
  await expect(fenced).toHaveCount(0);
  await expect(seaTag).toHaveCount(0);
  await expect(parkTag).toHaveCount(0);
  const options = page.getByTestId('property-options');
  const published = page.getByRole('checkbox', { name: 'Опубликован', exact: true });
  await published.focus();
  await page.keyboard.press('Space');
  await expect(published).toBeChecked();
  for (const name of ['На главной', 'Демонстрационный объект']) {
    await page.getByRole('checkbox', { name, exact: true }).check();
  }
  await page.getByRole('combobox', { name: 'Тип объекта', exact: true }).click();
  await page.getByRole('option', { name: 'Квартира с ремонтом', exact: true }).click();
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
  await page.getByLabel('Файлы фотографий', { exact: true }).setInputFiles([
    { name: 'duplicate.png', mimeType: 'image/png', buffer: png },
    { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('broken') },
    { name: 'last.png', mimeType: 'image/png', buffer: png },
  ]);
  await expect(media.locator('.property-photo-card')).toHaveCount(5);
  await expect(page.getByText('Фотографии загружены: 1. Пропущено повторов: 1. Не удалось загрузить: broken.png.', { exact: false })).toBeVisible();
  expect(uploadNames).toEqual(['one.png', 'two.png', 'duplicate.png', 'broken.png', 'last.png']);
  // A local removal forces a gallery save, checking that duplicate responses did not duplicate saved IDs.
  await media.locator('.property-photo-card').last().getByRole('button', { name: 'Убрать', exact: true }).click();
  await expect(media.locator('.property-photo-card')).toHaveCount(4);
  await expect(page.getByLabel('Файлы фотографий', { exact: true })).toBeHidden();
  await expect(media).not.toContainText('Choose Files');
  await page.getByRole('button', { name: 'Сохранить объект', exact: true }).click();
  await expect(page.getByText('Объект сохранён.', { exact: true })).toBeVisible();
  expect(saved).toMatchObject({ published: true, featured: true, demo: true, elite: true, type: 'apartment', housingMarket: 'secondary', availableFloors: [2, 5], floors: 5, priority: 10 });
  expect(saved?.featureIds).toEqual(expect.arrayContaining(['heating-gas', 'location-sea', 'location-park']));
  expect((saved?.featureIds as string[]).filter(id => featureDictionary.find(feature => feature.id === id)?.group === 'heating')).toEqual(['heating-gas']);
  expect(saved?.featureIds).not.toContain('territory-fence');
  expect(saved?.featureOverrides).toEqual(expect.arrayContaining(['heating', 'territory', 'location']));
  expect(saved?.changedFields).toEqual(expect.arrayContaining(['featureIds', 'featureOverrides']));
  await expect(page.getByRole('textbox', { name: 'Доступные этажи', exact: true })).toHaveValue('2, 5');
  expect(savedImages).toHaveLength(4);
  expect(new Set(savedImages!.map(image => image.id)).size).toBe(4);

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
