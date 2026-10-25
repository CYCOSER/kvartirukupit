import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

const env = { ...parseEnv(await readFile('.env', 'utf8')), ...process.env };
const headers = { Origin: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3100' };

test('site database search links matching apartments once and preserves another complex', async ({ page, request }) => {
  const api = page.request;
  expect((await api.post('/api/admin/login', { headers, data: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD } })).ok()).toBe(true);
  const unique = Date.now();
  const ids: string[] = [];
  const base = {
    title: 'Проверка поиска квартир', type: 'complex', location: 'Тестоград', address: '',
    nmarketComplexId: `e2e-${unique}`, price: null, status: 'available', area: null, bedrooms: null,
    floors: null, landArea: null, readiness: 'Готов', finish: 'Чистовая', description: '',
    utilities: [], published: false, featured: false, demo: true,
  };
  const create = async (data: Record<string, unknown>) => {
    const response = await api.post('/api/admin/properties', { headers, data: { ...base, slug: `test-find-${unique}-${ids.length}`, ...data } });
    expect(response.ok()).toBe(true);
    const property = await response.json(); ids.push(property.id); return property;
  };
  try {
    const target = await create({});
    const other = await create({ nmarketComplexId: `other-${unique}` });
    const unlinked = await create({ type: 'apartment' });
    const conflict = await create({ type: 'apartment', complexId: other.id });
    const unrelated = await create({ type: 'apartment', nmarketComplexId: `different-${unique}` });
    const endpoint = `/api/admin/properties/${target.id}/find-apartments`;
    expect((await request.post(endpoint, { headers, data: { source: 'local' } })).status()).toBe(401);
    expect((await api.post(endpoint, { headers, data: { source: 'invalid' } })).status()).toBe(400);
    const first = await api.post(endpoint, { headers, data: { source: 'local' } });
    expect(first.ok()).toBe(true);
    expect(await first.json()).toMatchObject({ count: 2, linked: 1, existing: 0, conflicts: 1 });
    const repeat = await api.post(endpoint, { headers, data: { source: 'local' } });
    expect(await repeat.json()).toMatchObject({ count: 2, linked: 0, existing: 1, conflicts: 1 });
    for (const [id, complexId] of [[unlinked.id, target.id], [conflict.id, other.id], [unrelated.id, null]]) {
      expect((await (await api.get('/api/admin/properties/' + id)).json()).complexId).toBe(complexId);
    }
  } finally {
    for (const id of ids.reverse()) expect((await api.delete('/api/admin/properties/' + id, { headers })).ok()).toBe(true);
  }
});
