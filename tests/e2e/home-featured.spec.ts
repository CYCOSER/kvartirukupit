import { expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { test } from './fixtures/admin-session';
import { propertyFixture } from './fixtures/property';
import type { Property } from '../../shared/property';

test('homepage follows individual and bulk featured flags without including drafts or unselected objects', async ({ page }) => {
  const request = page.request;
  const headers = { Origin: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3100' };
  const ids: string[] = [];
  async function create(values: Partial<Property>) {
    const response = await request.post('/api/admin/properties', {
      headers, data: propertyFixture({ slug: `homepage-${randomUUID()}`, ...values }),
    });
    expect(response.ok()).toBe(true);
    const item = await response.json();
    ids.push(item.id);
    return item;
  }
  async function home() {
    const response = await request.get('/api/properties/random');
    expect(response.ok()).toBe(true);
    const { items } = await response.json();
    for (const item of items) expect(item).toMatchObject({ featured: true, published: true, status: 'available', elite: false });
    return items as Property[];
  }
  try {
    const complex = await create({ title: 'Выбранный ЖК', type: 'complex', housingMarket: null, featured: true });
    const apartment = await create({ title: 'Выбранная квартира', featured: false });
    const draft = await create({ featured: true, published: false });
    const sold = await create({ featured: true, status: 'sold' });
    await expect.poll(async () => (await home()).some(item => item.id === complex.id)).toBe(true);
    expect((await home()).map(item => item.id)).not.toContain(apartment.id);
    for (const item of await home()) expect([draft.id, sold.id]).not.toContain(item.id);

    expect((await request.post('/api/admin/properties/bulk', {
      headers, data: { action: 'feature', ids: [apartment.id] },
    })).ok()).toBe(true);
    await expect.poll(async () => (await home()).some(item => item.id === apartment.id)).toBe(true);
    await expect.poll(async () => {
      await page.goto('/');
      return page.locator(`#collection a[href="/catalog/${apartment.slug}"]`).count();
    }, { timeout: 15000 }).toBeGreaterThan(0);
    for (const hidden of [draft, sold]) await expect(page.locator(`#collection a[href="/catalog/${hidden.slug}"]`)).toHaveCount(0);

    expect((await request.post('/api/admin/properties/bulk', {
      headers, data: { action: 'unfeature', ids: [complex.id] },
    })).ok()).toBe(true);
    expect((await home()).some(item => item.id === complex.id)).toBe(false);
    expect((await request.put(`/api/admin/properties/${apartment.id}`, {
      headers, data: { ...apartment, featured: false, changedFields: ['featured'] },
    })).ok()).toBe(true);
    for (const item of await home()) expect(ids).not.toContain(item.id);
  } finally {
    const deleted = await Promise.allSettled(ids.map(id => request.delete(`/api/admin/properties/${id}`, { headers })));
    for (const result of deleted) {
      expect(result.status).toBe('fulfilled');
      if (result.status === 'fulfilled') expect(result.value.ok()).toBe(true);
    }
  }
});
