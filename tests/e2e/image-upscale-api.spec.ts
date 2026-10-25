import { test, expect, request } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import sharp from 'sharp';

const env = { ...parseEnv(await readFile('.env', 'utf8')), ...process.env };
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3100';
const headers = { Origin: baseURL };

test('CPU worker automatically enhances the first photo, skips plans and other photos, and accepts manual enhancement', async ({ request: api }) => {
  test.setTimeout(360000);
  expect((await api.post('/api/admin/login', { headers, data: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD } })).ok()).toBe(true);
  const created = await api.post('/api/admin/properties', { headers, data: {
    title: 'Проверка CPU апскейла', slug: 'test-cpu-upscale-' + Date.now(), type: 'apartment', location: 'Калининград',
    price: null, area: null, bedrooms: null, floors: null, landArea: null, status: 'available',
    readiness: 'Уточняется', finish: 'Уточняется', description: '', utilities: [], published: false, featured: false, demo: true,
  } });
  expect(created.ok()).toBe(true);
  const property = await created.json();
  const propertyUrl = `/api/admin/properties/${property.id}`;
  try {
    const upload = async (width: number, height: number, alt: string) => {
      const source = await sharp({ create: { width, height, channels: 3, background: '#c98b32' } }).png().toBuffer();
      const response = await api.post(propertyUrl + '/images', { headers,
        multipart: { file: { name: 'photo.png', mimeType: 'image/png', buffer: source }, alt } });
      expect(response.ok()).toBe(true);
      return response.json();
    };
    const plan = await upload(128, 96, 'Планировка');
    expect((await api.post(`${propertyUrl}/images/${plan.id}/plan`, { headers, data: {} })).ok()).toBe(true);
    const photo = await upload(512, 384, 'Автоматический фон');
    const other = await upload(256, 192, 'Вручную');
    const endpoint = (id: string) => `${propertyUrl}/images/${id}`;
    const photoOriginal = await (await api.get(photo.file)).body();
    const otherOriginal = await (await api.get(other.file)).body();
    const anonymous = await request.newContext({ baseURL });
    try {
      expect((await anonymous.get(endpoint(other.id) + '/upscale')).status()).toBe(401);
      expect((await anonymous.post(endpoint(other.id) + '/upscale', { headers, data: { expectedFile: other.file } })).status()).toBe(401);
      expect((await anonymous.post(endpoint(other.id) + '/upscale-revert', { headers, data: { expectedFile: other.file } })).status()).toBe(401);
    } finally { await anonymous.dispose(); }
    expect((await api.post(endpoint(other.id) + '/upscale', { headers: { Origin: 'https://untrusted.example' }, data: { expectedFile: other.file } })).status()).toBe(403);
    expect((await (await api.get(endpoint(other.id) + '/upscale')).json()).status).toBeNull();
    await expect.poll(async () => (await (await api.get(endpoint(photo.id) + '/upscale')).json()).status,
      { timeout: 270000, intervals: [3000] }).toBe('completed');
    const enhanced = await (await api.get(endpoint(photo.id) + '/editor')).json();
    expect(enhanced.originalFile).toBe(photo.file);
    expect(await sharp(await (await api.get(enhanced.file)).body()).metadata()).toMatchObject({ width: 1920, height: 1440 });
    expect(await (await api.get(photo.file)).body()).toEqual(photoOriginal);
    expect((await api.post(endpoint(photo.id) + '/upscale-revert', { headers: { Origin: 'https://untrusted.example' }, data: { expectedFile: enhanced.file } })).status()).toBe(403);
    const reverted = await api.post(endpoint(photo.id) + '/upscale-revert', { headers, data: { expectedFile: enhanced.file } });
    expect(reverted.ok()).toBe(true);
    expect((await reverted.json()).file).toBe(photo.file);
    expect((await (await api.get(endpoint(photo.id) + '/upscale')).json()).status).toBe('reverted');
    expect((await api.post(endpoint(photo.id) + '/upscale-revert', { headers, data: { expectedFile: enhanced.file } })).status()).toBe(409);
    expect((await (await api.get(endpoint(plan.id) + '/upscale')).json()).status).toBeNull();
    expect((await (await api.get(endpoint(other.id) + '/upscale')).json()).status).toBeNull();
    expect((await api.post(endpoint(other.id) + '/upscale', { headers, data: { expectedFile: other.file } })).ok()).toBe(true);
    await expect.poll(async () => (await (await api.get(endpoint(other.id) + '/upscale')).json()).status,
      { timeout: 60000, intervals: [2000] }).toBe('completed');
    const manual = await (await api.get(endpoint(other.id) + '/editor')).json();
    expect(manual.originalFile).toBe(other.file);
    expect(await sharp(await (await api.get(manual.file)).body()).metadata()).toMatchObject({ width: 512, height: 384 });
    expect(await (await api.get(other.file)).body()).toEqual(otherOriginal);
    const unchanged = await api.post(endpoint(other.id) + '/edit', { headers, data: { expectedFile: manual.file, crop: null, hueShift: 0 } });
    expect(unchanged.ok()).toBe(true);
    expect((await unchanged.json()).file).toBe(manual.file);
    // A full discovery interval must pass without undoing the administrator's rollback.
    await new Promise(resolve => setTimeout(resolve, 32000));
    const afterScan = await (await api.get(endpoint(photo.id) + '/upscale')).json();
    expect(afterScan.status).toBe('reverted');
    expect(afterScan.file).toBe(photo.file);
  } finally {
    expect((await api.delete(propertyUrl, { headers })).ok()).toBe(true);
  }
});
