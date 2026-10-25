import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import sharp from 'sharp';

const env = { ...parseEnv(await readFile('.env', 'utf8')), ...process.env };
const origin = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3100';

test('Admin turns an existing plan blue, keeps its original file and cannot transform another property image', async ({ page, request }) => {
  const headers = { Origin: origin };
  const login = await page.request.post('/api/admin/login', { headers, data: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD } });
  expect(login.ok()).toBe(true);
  const created = await page.request.post('/api/admin/properties', { headers, data: {
    title: 'Проверка синей планировки', slug: 'test-blue-plan-' + Date.now(), type: 'apartment', location: 'Калининград',
    price: null, area: null, bedrooms: null, floors: null, landArea: null, status: 'available',
    readiness: 'Уточняется', finish: 'Уточняется', description: '', utilities: [], published: false, featured: false, demo: false,
  } });
  expect(created.ok()).toBe(true);
  const property = await created.json();
  try {
    const source = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#ffd161' } }).png().toBuffer();
    const uploaded = await page.request.post(`/api/admin/properties/${property.id}/images`, { headers,
      multipart: { file: { name: 'plan.png', mimeType: 'image/png', buffer: source }, alt: 'Тестовая планировка' } });
    expect(uploaded.ok()).toBe(true);
    const image = await uploaded.json();
    const original = await (await page.request.get(image.file)).body();
    const endpoint = `/api/admin/properties/${property.id}/images/${image.id}/plan`;
    expect((await request.post(endpoint, { headers, data: {} })).status()).toBe(401);
    expect((await page.request.post(`/api/admin/properties/missing/images/${image.id}/plan`, { headers, data: {} })).status()).toBe(404);
    expect((await page.request.post(endpoint, { headers, data: {} })).ok()).toBe(true);
    const saved = await (await page.request.get(`/api/admin/properties/${property.id}`)).json();
    expect(saved.images).toHaveLength(1);
    const changed = saved.images[0];
    expect(changed.kind).toBe('plan');
    expect(changed.file).not.toBe(image.file);
    const data = await sharp(await (await page.request.get(changed.file)).body()).raw().toBuffer();
    expect(data[2]).toBeGreaterThan(data[1]!);
    expect(data[1]).toBeGreaterThan(data[0]!);
    const sourcePixels = await sharp(original).raw().toBuffer();
    expect(Math.min(...data.subarray(0, 3))).toBe(Math.min(...sourcePixels.subarray(0, 3)));
    expect(Math.max(...data.subarray(0, 3))).toBe(Math.max(...sourcePixels.subarray(0, 3)));
    expect(await (await page.request.get(image.file)).body()).toEqual(original);
    const repeated = await page.request.post(endpoint, { headers, data: {} });
    expect(repeated.ok()).toBe(true);
    expect((await repeated.json()).file).toBe(changed.file);
  } finally {
    await page.request.delete(`/api/admin/properties/${property.id}`, { headers });
  }
});
