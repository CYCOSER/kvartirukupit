import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import sharp from 'sharp';

const env = { ...parseEnv(await readFile('.env', 'utf8')), ...process.env };
const headers = { Origin: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3100' };

test('upscale button protects drafts, follows background progress and refreshes the gallery', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  expect((await page.request.post('/api/admin/login', {
    headers, data: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
  })).ok()).toBe(true);
  const created = await page.request.post('/api/admin/properties', { headers, data: {
    title: 'Проверка улучшения фото', slug: 'test-upscale-ui-' + Date.now(), type: 'apartment', location: 'Калининград',
    price: null, area: null, bedrooms: null, floors: null, landArea: null, status: 'available',
    readiness: 'Уточняется', finish: 'Уточняется', description: '', utilities: [], published: false, featured: false, demo: true,
  } });
  expect(created.ok()).toBe(true);
  const property = await created.json();
  const propertyUrl = `/api/admin/properties/${property.id}`;
  try {
    const upload = async (background: string, alt: string) => {
      const source = await sharp({ create: { width: 2400, height: 1600, channels: 3, background } }).png().toBuffer();
      const response = await page.request.post(propertyUrl + '/images', { headers,
        multipart: { file: { name: 'original.png', mimeType: 'image/png', buffer: source }, alt },
      });
      expect(response.ok()).toBe(true);
      return response.json();
    };
    const image = await upload('#c98b32', 'Тест апскейла');
    const enhanced = await upload('#557799', 'Результат апскейла');
    const imageUrl = propertyUrl + `/images/${image.id}`;
    const originalMetadata = await (await page.request.get(imageUrl + '/editor')).json();
    let status: string | null = null;
    let currentFile: string = image.file;
    let requestBody: unknown;
    let upscaleRequests = 0;
    await page.route('**' + imageUrl + '/editor', route => route.fulfill({ json: {
      ...originalMetadata, file: currentFile, editFile: status === 'completed' ? currentFile : originalMetadata.originalFile,
      upscale: { status, error: null, available: true },
    } }));
    await page.route('**' + imageUrl + '/upscale', route => {
      if (route.request().method() === 'POST') {
        upscaleRequests++;
        requestBody = route.request().postDataJSON();
        status = 'queued';
      }
      return route.fulfill({ json: { status, error: null, file: currentFile } });
    });
    await page.route('**' + imageUrl + '/upscale-revert', route => {
      expect(route.request().postDataJSON()).toEqual({ expectedFile: enhanced.file });
      status = 'reverted';
      currentFile = image.file;
      return route.fulfill({ json: { ...originalMetadata, file: currentFile } });
    });
    await page.goto('/morskoy-kabinet-7q4x/properties/' + property.id);
    const trigger = page.getByRole('button', { name: 'Редактировать фото: Тест апскейла', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Редактировать фото', exact: true });
    const enhance = dialog.getByRole('button', { name: 'Улучшить качество', exact: true });
    const save = dialog.getByRole('button', { name: 'Сохранить изменения', exact: true });
    await expect(enhance).toBeEnabled();
    await dialog.getByLabel('Сдвиг цветового тона, градусы').fill('18');
    await expect(enhance).toBeDisabled();
    await expect(dialog).toContainText('Сначала сохраните обрезку и цвет');
    await dialog.getByRole('button', { name: 'Сбросить цвет', exact: true }).click();
    await enhance.click();
    await expect(dialog.getByRole('button', { name: 'В очереди на улучшение…', exact: true })).toBeDisabled();
    expect(requestBody).toEqual({ expectedFile: image.file });
    await expect(save).toBeDisabled();
    await dialog.getByRole('button', { name: 'Закрыть редактор фото', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await trigger.click();
    await expect(dialog.getByRole('button', { name: 'В очереди на улучшение…', exact: true })).toBeDisabled();
    status = 'processing';
    await expect(dialog.getByRole('button', { name: 'Улучшаем качество…', exact: true })).toBeDisabled();
    status = 'completed';
    currentFile = enhanced.file;
    const showOriginal = dialog.getByRole('button', { name: 'Открыть оригинал', exact: true });
    const showEnhanced = dialog.getByRole('button', { name: 'Открыть улучшенное', exact: true });
    await expect(showOriginal).toBeEnabled();
    await expect(page.locator('.admin-gallery > div > img').first()).toHaveAttribute('src', enhanced.file);
    const canvas = dialog.locator('canvas');
    const original = dialog.getByTestId('image-editor-original');
    const pixel = () => canvas.evaluate((element: HTMLCanvasElement) => Array.from(element.getContext('2d')!.getImageData(0, 0, 1, 1).data));
    await expect(canvas).toBeVisible();
    await expect.poll(pixel).toEqual([85, 119, 153, 255]);
    await expect(dialog.getByRole('button', { name: 'Фото на сайте', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Обрезка и цвет', exact: true })).toHaveCount(0);
    await expect(dialog.getByLabel('Ширина, px')).toBeEnabled();
    await expect(dialog.getByLabel('Высота, px')).toBeEnabled();
    await expect(dialog.getByLabel('Сдвиг цветового тона, градусы')).toBeEnabled();
    await showOriginal.click();
    await expect(original).toHaveAttribute('src', originalMetadata.originalFile);
    await expect(dialog.getByLabel('Сдвиг цветового тона, градусы')).toBeEnabled();
    await dialog.getByLabel('Сдвиг цветового тона, градусы').fill('18');
    await expect(canvas).toBeVisible();
    await expect.poll(pixel).not.toEqual([85, 119, 153, 255]);
    await showOriginal.click();
    await showEnhanced.click();
    await expect(canvas).toBeVisible();
    await expect(page.locator('.admin-gallery > div > img').first()).toHaveAttribute('src', enhanced.file);
    await expect(dialog.getByLabel('Сдвиг цветового тона, градусы')).toHaveValue('18');
    await dialog.getByRole('button', { name: 'Сбросить цвет', exact: true }).click();
    await expect.poll(pixel).toEqual([85, 119, 153, 255]);
    expect(upscaleRequests).toBe(1);
    await page.setViewportSize({ width: 360, height: 900 });
    const revert = dialog.getByRole('button', { name: 'Отменить улучшение', exact: true });
    await revert.scrollIntoViewIfNeeded();
    await expect(revert).toBeVisible();
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await dialog.screenshot({ path: testInfo.outputPath('improved-photo-mobile.png') });
    await dialog.getByRole('button', { name: 'Отменить улучшение', exact: true }).click();
    await expect(original).toHaveCount(0);
    await expect(dialog.locator('canvas')).toBeVisible();
    await expect(enhance).toBeEnabled();
    await expect(dialog).toContainText('Улучшение отменено');
    await expect(page.locator('.admin-gallery > div > img').first()).toHaveAttribute('src', image.file);
    await page.setViewportSize({ width: 1280, height: 900 });

    await dialog.getByRole('button', { name: 'Закрыть редактор фото', exact: true }).click();
    status = null;
    currentFile = image.file;
    await trigger.click();
    await expect(enhance).toBeEnabled();
    await dialog.getByLabel('Сдвиг цветового тона, градусы').fill('25');
    currentFile = enhanced.file;
    status = 'completed';
    await expect(dialog.getByRole('alert')).toContainText('Ваши правки сохранены в окне');
    await expect(dialog.getByLabel('Сдвиг цветового тона, градусы')).toHaveValue('25');
    await dialog.getByRole('button', { name: 'Загрузить актуальную версию', exact: true }).click();
    await expect(dialog.getByLabel('Сдвиг цветового тона, градусы')).toHaveValue('0');
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('.admin-gallery > div > img').first()).toHaveAttribute('src', enhanced.file);
  } finally {
    expect((await page.request.delete(propertyUrl, { headers })).ok()).toBe(true);
  }
});
