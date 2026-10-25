import { test, expect, type Locator, type Page } from '@playwright/test';

const complex = { id: 'preview-complex', title: 'Тихий дом', slug: 'preview-complex', type: 'complex', location: 'Калининград', published: true, images: [] };
const property = {
  id: 'map-preview-fixture', title: '2-комнатная квартира · 55.4 м² · ЖК Тихий дом', slug: 'map-preview-fixture', type: 'apartment',
  location: 'Калининград', address: 'Сержанта Мишина, 81', latitude: 54.71, longitude: 20.45,
  price: 6000000, status: 'available', area: 55.4, bedrooms: 2, floors: 5, landArea: null,
  readiness: '3 кв. 2027', constructionStatus: 'строится', finish: 'Чистовая', seaDistance: null, description: '', utilities: [],
  published: true, featured: false, elite: false, demo: false, sourceMode: 'nmarket-copy', sourceId: 'nmarket:apartment:preview',
  complexId: complex.id, complex, images: [{ id: 'preview-photo', file: '/images/baltic-coast.webp', alt: 'Фото', order: 0, kind: 'photo' }],
};

async function editor(page: Page) {
  let saved: Record<string, unknown> | undefined;
  await page.route('**/api/admin/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/admin/login' || url.pathname === '/api/admin/me') return route.fulfill({ json: { ok: true } });
    if (url.pathname === '/api/admin/properties') return route.fulfill({ json: url.searchParams.get('type') === 'complex' ? [complex] : [property] });
    if (url.pathname === `/api/admin/properties/${property.id}`) {
      if (route.request().method() === 'PUT') saved = route.request().postDataJSON();
      return route.fulfill({ json: { ...property, ...saved } });
    }
    if (url.pathname.endsWith('/images')) return route.fulfill({ json: { ok: true } });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64') }));
  await page.goto('/admin-console-9Xk6uiIs/login');
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__);
  await page.getByLabel('Email', { exact: true }).fill('fixture@example.com');
  await page.getByLabel('Пароль', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('link', { name: property.title, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Найти адрес на карте', exact: true })).toBeEnabled();
  return () => saved;
}

test('address search selects coordinates, preserves short address, clears stale points and allows map correction', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const saved = await editor(page);
  const map = page.getByTestId('property-address-map');
  const canvas = page.getByTestId('property-address-map-canvas');
  const bounds = await canvas.boundingBox();
  expect((await map.boundingBox())!.width).toBeLessThanOrEqual(960);
  expect(bounds!.width / bounds!.height).toBeCloseTo(16 / 9, 1);
  await expect(map.locator('.leaflet-tile-loaded').first()).toBeAttached();
  const zoom = () => map.locator('.leaflet-tile').evaluateAll(images => Math.max(...images.map(image => Number(new URL((image as HTMLImageElement).src).pathname.split('/')[1]))));
  const initialZoom = await zoom();
  await canvas.hover();
  await page.mouse.wheel(0, -500);
  await expect.poll(zoom).toBeGreaterThan(initialZoom);
  await expect(page.getByLabel('Широта (для карты)', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Долгота (для карты)', { exact: true })).toHaveCount(0);
  await expect(map.locator('.property-address-pin')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Карточка ЖК', exact: true })).toHaveAttribute('href', '/admin-console-9Xk6uiIs/properties/' + complex.id);
  let query = '';
  await page.route('**/api/map/search?**', route => {
    query = new URL(route.request().url()).searchParams.get('q') || '';
    return route.fulfill({ json: { items: [
      { id: 'one', label: 'Сержанта Мишина, 81, корпус 1', latitude: 54.713123, longitude: 20.445654 },
      { id: 'two', label: 'Сержанта Мишина, 81, корпус 2', latitude: 54.714123, longitude: 20.446654 },
    ] } });
  });
  await page.getByRole('button', { name: 'Найти адрес на карте', exact: true }).click();
  await expect(map.getByRole('list', { name: 'Найденные адреса' }).getByRole('button')).toHaveCount(2);
  expect(query).toBe('Калининград, Сержанта Мишина, 81');
  await map.getByRole('button', { name: 'Сержанта Мишина, 81, корпус 2', exact: true }).click();
  await map.screenshot({ path: testInfo.outputPath('address-map-desktop.png') });
  await page.getByRole('button', { name: 'Сохранить объект', exact: true }).click();
  await expect.poll(saved).toMatchObject({ latitude: 54.714123, longitude: 20.446654, address: property.address, location: property.location });
  await page.getByLabel('Адрес', { exact: true }).fill('Сержанта Мишина, 83');
  await expect(map.locator('.property-address-pin')).toHaveCount(0);
  await page.getByRole('button', { name: 'Сохранить объект', exact: true }).click();
  await expect.poll(saved).toMatchObject({ latitude: null, longitude: null });
  await map.getByRole('button', { name: 'Метка в центре карты', exact: true }).click();
  await expect(map.locator('.property-address-pin')).toHaveCount(1);
  await page.getByRole('button', { name: 'Сохранить объект', exact: true }).click();
  await expect.poll(() => saved()?.latitude).not.toBeNull();
  await page.setViewportSize({ width: 360, height: 800 });
  await map.screenshot({ path: testInfo.outputPath('address-map-mobile.png') });
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', await page.locator('body').evaluate(element => element.clientWidth));
});

test('property textareas grow and shrink with the content and save the full text', async ({ page }) => {
  const saved = await editor(page);
  const utilities = Array.from({ length: 18 }, (_, index) => `Особенность ЖК ${index + 1}`);
  const description = Array.from({ length: 24 }, (_, index) => `Абзац ${index + 1}. Подробное описание квартиры и жилого комплекса.`).join('\n');
  const fields = [
    { field: page.getByLabel('Особенности ЖК (по одной на строку)', { exact: true }), value: utilities.join('\n') },
    { field: page.getByLabel('Описание', { exact: true }), value: description },
  ];
  const initialHeights: number[] = [];
  for (const { field, value } of fields) {
    initialHeights.push((await field.boundingBox())!.height);
    await field.fill(value);
    await expect.poll(async () => (await field.boundingBox())!.height).toBeGreaterThan(initialHeights.at(-1)!);
    await expect.poll(() => field.evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
  }
  await page.getByRole('button', { name: 'Сохранить объект', exact: true }).click();
  await expect.poll(saved).toMatchObject({ utilities, description });
  await page.setViewportSize({ width: 360, height: 800 });
  for (const { field } of fields) {
    await expect.poll(() => field.evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  for (const [index, { field }] of fields.entries()) {
    await field.fill('Короткий текст');
    await expect.poll(async () => (await field.boundingBox())!.height).toBeLessThanOrEqual(initialHeights[index]! + 1);
  }
});

async function presentation(card: Locator) {
  return card.evaluate(element => {
    const selectors = ['', '.card-image-link', '.card-photo-focus', '.card-body', '.card-body h3', '.card-location', '.card-specs', '.card-price', '.card-price strong', '.card-type'];
    const properties = ['display', 'backgroundColor', 'color', 'fontSize', 'fontWeight', 'lineHeight', 'padding', 'borderRadius', 'minHeight'];
    return selectors.map(selector => {
      const style = getComputedStyle(selector ? element.querySelector(selector)! : element);
      return Object.fromEntries(properties.map(property => [property, style[property as keyof CSSStyleDeclaration]]));
    });
  });
}

test('editor preview uses the same public card data, panels and appearance as the catalog', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await editor(page);
  await page.getByRole('button', { name: 'Предпросмотр карточки', exact: true }).click();
  const preview = page.getByTestId('property-card-preview').locator('.property-card');
  await expect(preview.getByRole('heading')).toHaveText('2-к кв. 55.4 м²');
  await expect(preview).toContainText('ЖК Тихий дом');
  await expect(preview.locator('.card-open')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  const text = await preview.innerText();
  const styles = await presentation(preview);
  const dimensions = await preview.boundingBox();
  await preview.screenshot({ path: testInfo.outputPath('card-preview.png') });
  await page.route('**/api/properties?**', route => route.fulfill({ json: { items: [{ ...property, title: '2-к кв. 55.4 м²' }], total: 1, pages: 1, locations: ['Калининград'] } }));
  await page.locator('.admin-site-link').click();
  await page.locator('a[href="/catalog"]').first().click();
  const publicCard = page.locator('.catalog-grid .property-card').first();
  await expect(publicCard.getByRole('heading')).toHaveText('2-к кв. 55.4 м²');
  expect(await publicCard.innerText()).toBe(text);
  expect(await presentation(publicCard)).toEqual(styles);
  const publicDimensions = await publicCard.boundingBox();
  expect(publicDimensions!.width).toBeCloseTo(dimensions!.width, 0);
  expect(publicDimensions!.height).toBeCloseTo(dimensions!.height, 0);
});
