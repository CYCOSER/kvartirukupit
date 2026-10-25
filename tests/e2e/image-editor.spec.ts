import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import sharp from 'sharp';

const env = { ...parseEnv(await readFile('.env', 'utf8')), ...process.env };
const headers = { Origin: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3100' };

test('photo editor previews colour, crops original pixels, keeps edits on failure and restores the original', async ({ page }) => {
  test.setTimeout(120000);
  expect((await page.request.post('/api/admin/login', {
    headers, data: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
  })).ok()).toBe(true);
  const created = await page.request.post('/api/admin/properties', { headers, data: {
    title: 'Проверка редактора фото', slug: 'test-image-editor-' + Date.now(), type: 'apartment', location: 'Калининград',
    price: null, area: null, bedrooms: null, floors: null, landArea: null, status: 'available',
    readiness: 'Уточняется', finish: 'Уточняется', description: '', utilities: [], published: false, featured: false, demo: true,
  } });
  expect(created.ok()).toBe(true);
  const property = await created.json();
  const propertyUrl = `/api/admin/properties/${property.id}`;
  try {
    const source = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#c98b32' } }).png().toBuffer();
    const uploaded = await page.request.post(propertyUrl + '/images', { headers,
      multipart: { file: { name: 'original.png', mimeType: 'image/png', buffer: source }, alt: 'Фото для проверки редактора' },
    });
    expect(uploaded.ok()).toBe(true);
    const image = await uploaded.json();
    const original = await (await page.request.get(image.file)).body();
    expect(await sharp(original).metadata()).toMatchObject({ width: 2400, height: 1600 });
    expect(await sharp(original).ensureAlpha().raw().toBuffer()).toEqual(await sharp(source).ensureAlpha().raw().toBuffer());
    const editorUrl = propertyUrl + `/images/${image.id}`;
    await page.goto('/admin-console-9Xk6uiIs/properties/' + property.id);
    await expect(page.getByText('Синяя планировка', { exact: true })).toHaveCount(0);
    const trigger = page.getByRole('button', { name: 'Редактировать фото: Фото для проверки редактора' });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Редактировать фото', exact: true });
    const save = dialog.getByRole('button', { name: 'Сохранить изменения', exact: true });
    await expect(save).toBeEnabled();
    await expect(dialog).toContainText('Оригинал: 2400 × 1600 px');
    const canvas = dialog.locator('canvas');
    const pixel = () => canvas.evaluate((element: HTMLCanvasElement) => Array.from(element.getContext('2d')!.getImageData(0, 0, 1, 1).data));
    const initialPixel = await pixel();
    const slider = dialog.getByRole('slider', { name: 'Цветовой тон (RGB)' });
    await expect(slider).toHaveCSS('padding-left', '0px');
    await expect(slider).toHaveCSS('padding-right', '0px');
    await expect(slider).toHaveCSS('border-left-width', '0px');
    const sliderBounds = (await slider.boundingBox())!;
    await page.mouse.click(sliderBounds.x + 1, sliderBounds.y + sliderBounds.height / 2);
    await expect(slider).toHaveValue('-180');
    await page.mouse.click(sliderBounds.x + sliderBounds.width - 1, sliderBounds.y + sliderBounds.height / 2);
    await expect(slider).toHaveValue('180');
    await slider.press('End');
    await expect.poll(pixel).not.toEqual(initialPixel);
    await expect(dialog.getByLabel('Сдвиг цветового тона, градусы')).toHaveValue('180');
    await dialog.getByLabel('Сдвиг цветового тона, градусы').fill('12.5');
    await expect(save).toBeDisabled();
    await dialog.getByLabel('Сдвиг цветового тона, градусы').fill('180');

    const stage = dialog.getByTestId('image-crop-stage');
    const bounds = (await stage.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width / 4, bounds.y + bounds.height / 4);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * 3 / 4, bounds.y + bounds.height * 3 / 4, { steps: 4 });
    await page.mouse.up();
    expect(Number(await dialog.getByLabel('Слева, px').inputValue())).toBeCloseTo(600, -1);
    expect(Number(await dialog.getByLabel('Ширина, px').inputValue())).toBeCloseTo(1200, -1);
    await dialog.getByLabel('Слева, px').fill('50');
    await dialog.getByLabel('Сверху, px').fill('100');
    await dialog.getByLabel('Ширина, px').fill('2400');
    await expect(save).toBeDisabled();
    await dialog.getByLabel('Ширина, px').fill('2200');
    await dialog.getByLabel('Высота, px').fill('1400');
    await expect(save).toBeEnabled();
    await dialog.screenshot({ path: 'test-results/image-editor-desktop.png' });

    await page.route('**' + editorUrl + '/edit', (route) => route.fulfill({
      status: 500, json: { message: 'Проверочная ошибка сохранения' },
    }));
    await save.click();
    await expect(dialog.getByRole('alert')).toContainText('Проверочная ошибка сохранения');
    await expect(dialog.getByLabel('Ширина, px')).toHaveValue('2200');
    await expect(slider).toHaveValue('180');
    await expect(page.locator('.admin-gallery > div > img')).toHaveAttribute('src', image.file);
    await page.unroute('**' + editorUrl + '/edit');

    const savedResponse = page.waitForResponse((response) => response.url().endsWith(editorUrl + '/edit') && response.request().method() === 'POST');
    await save.click();
    const response = await savedResponse;
    expect(response.ok()).toBe(true);
    expect(response.request().postDataJSON()).toEqual({
      expectedFile: image.file, crop: { left: 50, top: 100, width: 2200, height: 1400 }, hueShift: 180,
    });
    const edited = await response.json();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('.admin-gallery > div > img')).toHaveAttribute('src', edited.file);
    const output = await (await page.request.get(edited.file)).body();
    expect(await sharp(output).metadata()).toMatchObject({ width: 2200, height: 1400 });
    const editedPixel = await sharp(output).ensureAlpha().raw().toBuffer();
    expect(Array.from(editedPixel.subarray(0, 4))).not.toEqual(initialPixel);
    expect(await (await page.request.get(image.file)).body()).toEqual(original);

    await page.reload();
    await page.setViewportSize({ width: 360, height: 800 });
    await trigger.click();
    await expect(save).toBeEnabled();
    await expect(dialog.getByLabel('Слева, px')).toHaveValue('50');
    await expect(dialog.getByLabel('Ширина, px')).toHaveValue('2200');
    await expect(slider).toHaveValue('180');
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect.poll(pixel).toEqual(Array.from(editedPixel.subarray(0, 4)));
    await dialog.screenshot({ path: 'test-results/image-editor-mobile.png' });

    await page.route('**' + editorUrl + '/edit', (route) => route.fulfill({
      status: 409, json: { message: 'Изображение изменено в другом окне' },
    }));
    await save.click();
    await expect(dialog.getByRole('alert')).toContainText('Изображение изменено в другом окне');
    await page.unroute('**' + editorUrl + '/edit');
    await dialog.getByRole('button', { name: 'Загрузить актуальную версию' }).click();
    await expect(save).toBeEnabled();
    await expect(dialog.getByRole('alert')).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Сбросить обрезку' }).click();
    await dialog.getByRole('button', { name: 'Сбросить цвет' }).click();
    await expect(dialog.getByLabel('Ширина, px')).toHaveValue('2400');
    await expect(slider).toHaveValue('0');
    const resetResponse = page.waitForResponse((response) => response.url().endsWith(editorUrl + '/edit') && response.request().method() === 'POST');
    await save.click();
    const reset = await resetResponse;
    expect(reset.ok()).toBe(true);
    expect(reset.request().postDataJSON()).toMatchObject({ crop: null, hueShift: 0 });
    const restored = await reset.json();
    expect(await (await page.request.get(restored.file)).body()).toEqual(original);
    await expect(dialog).not.toBeVisible();
  } finally {
    expect((await page.request.delete(propertyUrl, { headers })).ok()).toBe(true);
  }
});
