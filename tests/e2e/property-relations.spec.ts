import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

const env = { ...parseEnv(await readFile('.env', 'utf8')), ...process.env };
const headers = { Origin: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3100' };

test('apartments link to a complex, draft relations stay private and deleting a complex preserves apartments', async ({ page }) => {
  const request = page.request;
  expect((await request.post('/api/admin/login', {
    headers, data: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
  })).ok()).toBe(true);
  const suffix = Date.now();
  const base = {
    title: 'Проверочная квартира', slug: `e2e-relation-${suffix}`, type: 'apartment', location: 'Калининград',
    price: 6000000, status: 'available', area: 42, landArea: null, bedrooms: 1, floors: 5,
    readiness: 'Готов', finish: 'Чистовая', description: 'Временный объект проверки связей.',
    utilities: [], published: false, featured: false, demo: true,
  };
  const ids: string[] = [];
  const create = async (data: Record<string, unknown>) => {
    const response = await request.post('/api/admin/properties', { headers, data: { ...base, ...data } });
    expect(response.ok()).toBe(true);
    const item = await response.json();
    ids.push(item.id);
    return item;
  };
  try {
    const complex = await create({ type: 'complex', title: `Тестовый ЖК ${suffix}`, slug: `e2e-complex-${suffix}` });
    const apartment = await create({ title: `${base.title} ${suffix}`, published: true, complexId: complex.id });
    const draft = await create({ title: 'Скрытая квартира', slug: `e2e-draft-${suffix}`, complexId: complex.id });
    const apartmentUrl = '/api/admin/properties/' + apartment.id;
    const complexUrl = '/api/admin/properties/' + complex.id;
    const checkPublicCollections = async (published: boolean) => {
      const checkApartment = (item: any) => {
        expect(item).toBeDefined();
        if (published) expect(item.complex).toMatchObject({ id: complex.id, title: complex.title, slug: complex.slug });
        else {
          expect(item.complex).toBeNull();
          expect(JSON.stringify(item)).not.toContain(complex.title);
          expect(JSON.stringify(item)).not.toContain(complex.slug);
        }
      };
      for (const endpoint of ['/api/properties', '/api/properties/map']) {
        const response = await request.get(endpoint, { params: { q: String(suffix), type: 'apartment' } });
        expect(response.ok()).toBe(true);
        const result = await response.json();
        checkApartment(result.items.find((item: { id: string }) => item.id === apartment.id));
      }
      // Random has no filter; wait for this fixture without changing other catalog entries.
      let randomApartment: any;
      await expect.poll(async () => {
        const response = await request.get('/api/properties/random');
        expect(response.ok()).toBe(true);
        const result = await response.json();
        if (!published) expect(JSON.stringify(result)).not.toContain(complex.title);
        randomApartment = result.items.find((item: { id: string }) => item.id === apartment.id);
        return !!randomApartment;
      }, { timeout: 15000, intervals: [100, 250] }).toBe(true);
      checkApartment(randomApartment);
    };
    let publicApartment = await (await request.get('/api/properties/' + apartment.slug)).json();
    expect(publicApartment.complex).toBeNull();
    expect(JSON.stringify(publicApartment)).not.toContain(complex.title);
    await checkPublicCollections(false);
    expect((await request.put(complexUrl, { headers, data: { ...complex, type: 'apartment' } })).status()).toBe(400);
    for (const complexId of [apartment.id, draft.id, 'missing-complex']) {
      expect((await request.put(apartmentUrl, { headers, data: { ...apartment, complexId } })).status()).toBe(400);
    }
    const { complexId: omitted, ...oldClient } = apartment;
    expect((await request.put(apartmentUrl, { headers, data: { ...oldClient, title: `Квартира после правки ${suffix}` } })).ok()).toBe(true);
    expect((await (await request.get(apartmentUrl)).json()).complexId).toBe(complex.id);
    expect((await request.put(complexUrl, { headers, data: { ...complex, published: true } })).ok()).toBe(true);
    const publicComplex = await (await request.get('/api/properties/' + complex.slug)).json();
    expect(publicComplex.apartments.map((item: { id: string }) => item.id)).toEqual([apartment.id]);
    expect(JSON.stringify(publicComplex)).not.toContain(draft.title);
    publicApartment = await (await request.get('/api/properties/' + apartment.slug)).json();
    expect(publicApartment.complex.id).toBe(complex.id);
    await checkPublicCollections(true);
    await page.goto('/catalog/' + complex.slug);
    await expect(page.getByRole('heading', { name: 'Квартиры в этом ЖК', exact: true })).toBeVisible();
    await expect(page.locator(`a[href="/catalog/${apartment.slug}"]`)).toBeVisible();
    await expect(page.getByText(draft.title, { exact: true })).toHaveCount(0);
    await page.goto('/catalog/' + apartment.slug);
    await expect(page.locator('.detail-hero-script')).toHaveText('ЖК ' + complex.title);
    await expect(page.locator('.detail-hero .detail-parent-link')).toHaveCount(0);
    await expect(page.locator('#about-property .detail-parent-link')).toHaveAttribute('href', '/catalog/' + complex.slug);
    await expect(page.locator(`a[href="/catalog/${complex.slug}"]`)).toBeVisible();

    await page.goto('/admin-console-9Xk6uiIs/properties/' + apartment.id);
    const selector = page.getByRole('combobox', { name: 'Жилой комплекс квартиры', exact: true });
    await expect(selector).toContainText(complex.title);
    await page.getByRole('button', { name: 'Предпросмотр карточки', exact: true }).click();
    await expect(page.locator('.property-card .card-specs')).toContainText('ЖК ' + complex.title);
    await selector.click();
    await page.getByRole('option', { name: 'Без привязки к ЖК', exact: true }).click();
    await expect(page.locator('.property-card .card-specs')).not.toContainText(complex.title);
    await page.getByRole('button', { name: 'Сохранить объект', exact: true }).click();
    await expect(page.getByText('Объект сохранён.', { exact: true })).toBeVisible();
    expect((await (await request.get(apartmentUrl)).json()).complexId).toBeNull();
    await selector.click();
    await page.getByRole('option', { name: new RegExp(complex.title) }).click();
    await expect(page.locator('.property-card .card-specs')).toContainText('ЖК ' + complex.title);
    const saved = page.waitForResponse((response) => response.url().endsWith(apartmentUrl) && response.request().method() === 'PUT');
    await page.getByRole('button', { name: 'Сохранить объект', exact: true }).click();
    expect((await saved).ok()).toBe(true);
    expect((await (await request.get(apartmentUrl)).json()).complexId).toBe(complex.id);
    await page.goto('/admin-console-9Xk6uiIs/properties/' + complex.id);
    await expect(page.getByRole('heading', { name: 'Квартиры в этом ЖК · 2', exact: true })).toBeVisible();
    await expect(page.locator(`a[href="/admin-console-9Xk6uiIs/properties/${draft.id}"]`)).toBeVisible();
    expect((await request.delete(complexUrl, { headers })).ok()).toBe(true);
    ids.splice(ids.indexOf(complex.id), 1);
    expect((await (await request.get(apartmentUrl)).json()).complexId).toBeNull();
    expect((await (await request.get('/api/admin/properties/' + draft.id)).json()).complexId).toBeNull();
  } finally {
    for (const id of ids.reverse()) {
      expect((await request.delete('/api/admin/properties/' + id, { headers })).ok()).toBe(true);
    }
    await request.post('/api/admin/logout', { headers });
  }
});
