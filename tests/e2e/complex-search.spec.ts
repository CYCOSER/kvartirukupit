import { test, expect, type Page, type Route } from '@playwright/test';

const complex = {
  id: 'fixture-complex', title: 'ЖК для проверки поиска', slug: 'fixture-complex', type: 'complex',
  location: 'Калининград', address: 'Тестовый адрес', price: null, status: 'available',
  area: null, landArea: null, bedrooms: null, floors: null, latitude: null, longitude: null,
  readiness: 'Готов', finish: 'Чистовая', seaDistance: null, description: '', utilities: [],
  published: false, featured: false, elite: false, demo: false, sourceId: null, images: [], apartments: [],
};
async function openEditor(page: Page, handle: (route: Route, path: string) => Promise<boolean>) {
  // Every admin request is a browser fixture; no CRM or real catalog is changed.
  await page.route('**/api/admin/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (await handle(route, path)) return;
    if (path === '/api/admin/me' || path === '/api/admin/login') await route.fulfill({ json: { ok: true } });
    else if (path === '/api/admin/properties') await route.fulfill({ json: [complex] });
    else if (path === '/api/admin/properties/' + complex.id) await route.fulfill({ json: complex });
    else await route.fulfill({ status: 404, json: { message: 'Unexpected fixture request' } });
  });
  await page.goto('/morskoy-kabinet-7q4x/login');
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__);
  await page.getByLabel('Email', { exact: true }).fill('fixture@example.com');
  await page.getByLabel('Пароль', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('link', { name: complex.title, exact: true }).click();
  await expect(page.getByTestId('complex-apartment-search')).toBeVisible();
}

test('three sources run together, one failure does not stop others and an explicit saved retry works', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  const imports: { source: string; id: number | string; layoutId?: number; complexId: string; snapshot?: string }[] = [];
  const successful = new Set<string>();
  let round = 0;
  let refreshes = 0;
  let failApartment = true;
  let savedBody: Record<string, unknown> | undefined;
  let sourceMappings = { rf39ComplexId: null as string | null, rf39BuildingId: null as string | null };
  let searches: Route[] = [];
  let waitingForRescan = false;
  await openEditor(page, async (route, path) => {
    if (path.endsWith('/find-apartments')) {
      if (waitingForRescan && route.request().postDataJSON().source === 'local') {
        waitingForRescan = false;
        await route.fulfill({ json: { candidates: [], count: 3, linked: 0, existing: 2, conflicts: 1, matchedBy: 'Совпадение по ID ЖК', warnings: [] } });
        return true;
      }
      searches.push(route);
      // Holding responses until all three arrive also checks that source searches are parallel.
      if (searches.length === 3) {
        round++;
        waitingForRescan = true;
        const batch = searches;
        searches = [];
        await Promise.all(batch.map(async (search) => {
          const { source, snapshot } = search.request().postDataJSON();
          if (source === 'rf39') sourceMappings = { rf39ComplexId: 'discovered-development', rf39BuildingId: 'discovered-building' };
          if (source === 'nmarket' && snapshot !== 'saved') {
            await search.fulfill({ status: 503, json: { data: { message: 'Свежая выгрузка недоступна' } } });
            return;
          }
          await search.fulfill({ json: source === 'local'
            ? { candidates: [], count: 3, linked: round === 1 ? 1 : 0, existing: round === 1 ? 1 : 2, conflicts: 1, matchedBy: 'Совпадение по названию ЖК', warnings: [] }
            : source === 'nmarket'
              ? { candidates: [{ id: 'n100' }], matchedBy: 'Совпадение по ID ЖК', warnings: [], snapshotDate: '2026-10-19T10:00:00Z' }
              : { candidates: [{ id: 11 }, { id: 12, layoutId: 2 }, { id: 13 }], matchedBy: 'Совпадение по ID ЖК', warnings: [] },
          });
        }));
      }
      return true;
    }
    if (path.endsWith('/import')) {
      const source = path.includes('/nmarket/') ? 'nmarket' : 'rf39';
      const data = route.request().postDataJSON();
      imports.push({ source, ...data });
      if (data.id === 12 && failApartment) {
        failApartment = false;
        await route.fulfill({ status: 503, json: { data: { message: 'Не удалось загрузить планировку' } } });
        return true;
      }
      const key = `${source}:${data.id}`;
      const existed = successful.has(key);
      successful.add(key);
      await route.fulfill({ json: { id: key, created: !existed && data.id !== 13, linked: !existed, warnings: [] } });
      return true;
    }
    if (path === '/api/admin/properties/' + complex.id) {
      if (route.request().method() === 'PUT') {
        savedBody = route.request().postDataJSON();
        sourceMappings = { ...sourceMappings, ...savedBody };
        await route.fulfill({ json: { ...complex, ...sourceMappings } });
        return true;
      }
      refreshes++;
      await route.fulfill({ json: { ...complex, ...sourceMappings } });
      return true;
    }
    if (path === '/api/admin/properties/' + complex.id + '/images') {
      await route.fulfill({ json: { ok: true } });
      return true;
    }
    return false;
  });
  const search = page.getByRole('button', { name: 'Найти и привязать квартиры', exact: true });
  const rf39 = page.locator('[data-source="rf39"]');
  const nmarket = page.locator('[data-source="nmarket"]');
  const local = page.locator('[data-source="local"]');
  expect(imports).toHaveLength(0);
  await page.getByText('Связь с ЖК в Нмаркете и CRM', { exact: true }).click();
  await page.getByLabel('ID корпуса в CRM RF39 (необязательно)', { exact: true }).fill('manual-building');
  await search.click();
  await expect(search).toBeEnabled();
  await expect(nmarket.getByRole('alert')).toContainText('Свежая выгрузка недоступна');
  await expect(rf39.getByRole('alert')).toContainText('Объект 12, квартира 2: Не удалось загрузить планировку');
  expect(imports.map((item) => item.id)).toEqual([11, 12, 13]);
  expect(imports.every((item) => item.complexId === complex.id)).toBe(true);
  await expect(rf39.locator('[data-count="created"]')).toHaveText('1');
  await expect(rf39.locator('[data-count="linked"]')).toHaveText('1');
  await expect(rf39.locator('[data-count="errors"]')).toHaveText('1');
  await expect(local.locator('[data-count="existing"]')).toHaveText('1');
  await expect(local).toContainText('Уже связаны с другим ЖК: 1');
  expect(refreshes).toBeGreaterThanOrEqual(3); // Initial detail + completed local and RF39 branches.
  await expect(page.getByLabel('ID ЖК в CRM RF39', { exact: true })).toHaveValue('discovered-development');
  await expect(page.getByLabel('ID корпуса в CRM RF39 (необязательно)', { exact: true })).toHaveValue('manual-building');
  await page.getByRole('button', { name: 'Сохранить объект', exact: true }).click();
  await expect(page.getByText('Объект сохранён.', { exact: true })).toBeVisible();
  expect(savedBody).toHaveProperty('rf39BuildingId', 'manual-building');
  expect(savedBody).not.toHaveProperty('rf39ComplexId');

  await page.getByRole('combobox', { name: 'Данные Нмаркета для поиска квартир', exact: true }).click();
  await page.getByRole('option', { name: 'Сохранённая выгрузка', exact: true }).click();
  await expect(page.getByText('Сохранённая выгрузка может быть устаревшей.', { exact: false })).toBeVisible();
  await search.click();
  await expect(search).toBeEnabled();
  await expect(nmarket).toContainText('19.10.2026');
  await expect(rf39.locator('[data-count="created"]')).toHaveText('1');
  await expect(rf39.locator('[data-count="existing"]')).toHaveText('2');
  await expect(rf39.locator('[data-count="errors"]')).toHaveText('0');
  await expect(nmarket.locator('[data-count="created"]')).toHaveText('1');
  expect(imports.find((item) => item.source === 'nmarket')).toMatchObject({ id: 'n100', snapshot: 'saved', complexId: complex.id });
  await page.getByTestId('complex-apartment-search').screenshot({ path: testInfo.outputPath('complex-search-desktop.png') });
  await page.setViewportSize({ width: 390, height: 1700 });
  await page.locator('.complex-search-top h3').click();
  await page.getByTestId('complex-apartment-search').screenshot({ path: testInfo.outputPath('complex-search-mobile.png') });
});

test('stopping leaves the in-flight success visible and does not begin another apartment request', async ({ page }) => {
  let heldImport: Route | undefined;
  let importCompleted = false;
  let imports = 0;
  let refreshes = 0;
  let localSearches = 0;
  await page.setViewportSize({ width: 390, height: 900 });
  await openEditor(page, async (route, path) => {
    if (path.endsWith('/find-apartments')) {
      const { source } = route.request().postDataJSON();
      if (source === 'local') localSearches++;
      await route.fulfill({ json: {
        candidates: source === 'rf39' ? [{ id: 31 }, { id: 32 }, { id: 33 }] : [],
        count: source === 'local' ? 0 : undefined, linked: 0, existing: 0, conflicts: 0,
        matchedBy: 'Совпадение по ID ЖК', warnings: [],
      } });
      return true;
    }
    if (path.endsWith('/import')) { imports++; heldImport = route; return true; }
    if (path === '/api/admin/properties/' + complex.id) {
      refreshes++;
      await route.fulfill({ json: { ...complex, apartments: importCompleted ? [{ ...complex, id: 'linked-apartment', title: 'Квартира после остановки' }] : [] } });
      return true;
    }
    return false;
  });
  const search = page.getByRole('button', { name: 'Найти и привязать квартиры', exact: true });
  await search.click();
  await expect.poll(() => imports).toBe(1);
  await page.getByRole('button', { name: 'Остановить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Останавливаем…', exact: true })).toBeDisabled();
  importCompleted = true;
  await heldImport!.fulfill({ json: { id: 'linked-apartment', created: true, linked: true, warnings: [] } });
  await expect(search).toBeEnabled();
  expect(imports).toBe(1);
  expect(localSearches).toBe(1);
  await expect(page.locator('[data-source="rf39"]')).toContainText('Остановлено');
  await expect(page.locator('[data-source="rf39"] [data-count="created"]')).toHaveText('1');
  await expect(page.getByRole('link', { name: 'Квартира после остановки', exact: true })).toBeVisible();
  expect(refreshes).toBe(3); // Initial detail, empty Nmarket search (source IDs), then completed RF39 import.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('remote discovery triggers one final local scan and links an older local apartment without importing again', async ({ page }) => {
  const searches: string[] = [];
  let localSearches = 0;
  let imports = 0;
  let linked = false;
  await openEditor(page, async (route, path) => {
    if (path.endsWith('/find-apartments')) {
      const { source } = route.request().postDataJSON();
      searches.push(source);
      if (source === 'local') {
        localSearches++;
        linked = localSearches === 2;
        await route.fulfill({ json: {
          candidates: [], count: linked ? 1 : 0, linked: linked ? 1 : 0,
          existing: 0, conflicts: 0, matchedBy: linked ? 'Совпадение по найденному ID ЖК' : '', warnings: [],
        } });
      } else {
        await route.fulfill({ json: { candidates: [], matchedBy: 'Обнаружен ID ЖК', warnings: [] } });
      }
      return true;
    }
    if (path.endsWith('/import')) {
      imports++;
      await route.fulfill({ status: 500, json: { message: 'No external imports expected' } });
      return true;
    }
    if (path === '/api/admin/properties/' + complex.id) {
      await route.fulfill({ json: {
        ...complex, rf39ComplexId: searches.includes('rf39') ? 'discovered-id' : null,
        apartments: linked ? [{ ...complex, id: 'old-local-apartment', title: 'Ранее загруженная квартира' }] : [],
      } });
      return true;
    }
    return false;
  });
  const search = page.getByRole('button', { name: 'Найти и привязать квартиры', exact: true });
  await search.click();
  await expect(search).toBeEnabled();
  expect(new Set(searches.slice(0, 3))).toEqual(new Set(['local', 'nmarket', 'rf39']));
  expect(searches.slice(3)).toEqual(['local']);
  expect(imports).toBe(0);
  await expect(page.locator('[data-source="local"] [data-count="linked"]')).toHaveText('1');
  await expect(page.locator('[data-source="local"] [data-count="existing"]')).toHaveText('0');
  await expect(page.getByRole('link', { name: 'Ранее загруженная квартира', exact: true })).toBeVisible();
});

test('both source searches finish before Nmarket imports and CRM receives the preferred apartment', async ({ page }) => {
  const searches: { source: string; snapshot?: string }[] = [];
  const imports: { source: string; body: Record<string, unknown> }[] = [];
  let heldNmarket: Route | undefined;
  await openEditor(page, async (route, path) => {
    if (path.endsWith('/find-apartments')) {
      const body = route.request().postDataJSON();
      searches.push(body);
      if (body.source === 'nmarket') heldNmarket = route;
      else await route.fulfill({ json: {
        candidates: body.source === 'rf39' ? [{ id: 100, layoutId: 20, preferredNmarketId: 'apartment:99' }] : [],
        count: body.source === 'local' ? 0 : 1, linked: 0, existing: 0, conflicts: 0, matchedBy: '', warnings: [],
      } });
      return true;
    }
    if (path.endsWith('/import')) {
      const source = path.includes('/nmarket/') ? 'nmarket' : 'rf39';
      imports.push({ source, body: route.request().postDataJSON() });
      await route.fulfill({ json: { id: 'one-nmarket-draft', created: source === 'nmarket', linked: source === 'nmarket', warnings: [] } });
      return true;
    }
    return false;
  });
  await expect(page.getByRole('navigation', { name: 'Источник при совпадении квартиры' }).getByRole('button', { name: 'Нмаркет', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('combobox', { name: 'Данные Нмаркета для поиска квартир', exact: true }).click();
  await page.getByRole('option', { name: 'Сохранённая выгрузка', exact: true }).click();
  const search = page.getByRole('button', { name: 'Найти и привязать квартиры', exact: true });
  await search.click();
  await expect.poll(() => searches.length).toBe(3);
  expect(imports).toHaveLength(0);
  expect(searches.filter(value => value.source !== 'local').every(value => value.snapshot === 'saved')).toBe(true);
  await heldNmarket!.fulfill({ json: { candidates: [{ id: 'apartment:99' }], count: 1, matchedBy: '', warnings: [] } });
  await expect(search).toBeEnabled();
  expect(imports.map(value => value.source)).toEqual(['nmarket', 'rf39']);
  expect(imports[0]!.body).toMatchObject({ id: 'apartment:99', complexId: complex.id, snapshot: 'saved' });
  expect(imports[1]!.body).toMatchObject({ id: 100, layoutId: 20, complexId: complex.id, preferredNmarketId: 'apartment:99', nmarketSnapshot: 'saved', preferredSource: 'nmarket' });
  await expect(page.locator('[data-source="nmarket"] [data-count="created"]')).toHaveText('1');
  await expect(page.locator('[data-source="rf39"] [data-count="created"]')).toHaveText('0');
  await expect(page.locator('[data-source="rf39"] [data-count="existing"]')).toHaveText('1');
});

for (const failCrm of [false, true]) test(`selected CRM handles every duplicate without falling back to Nmarket (CRM failure: ${failCrm})`, async ({ page }) => {
  const imports: { source: string; body: Record<string, unknown> }[] = [];
  let heldImport: Route | undefined;
  await openEditor(page, async (route, path) => {
    if (path.endsWith('/find-apartments')) {
      const { source } = route.request().postDataJSON();
      await route.fulfill({ json: { candidates: source === 'rf39'
        ? [{ id: 100, layoutId: 20, preferredNmarketId: 'apartment:99', matchedNmarketIds: ['apartment:99', 'apartment:100'] }]
        : source === 'nmarket' ? [{ id: 'apartment:99' }, { id: 'apartment:100' }, { id: 'apartment:101' }] : [],
        linked: 0, existing: 0, conflicts: 0, matchedBy: '', warnings: [] } });
      return true;
    }
    if (path.endsWith('/import')) {
      const source = path.includes('/nmarket/') ? 'nmarket' : 'rf39';
      imports.push({ source, body: route.request().postDataJSON() });
      if (imports.length === 1) { heldImport = route; return true; }
      if (failCrm && source === 'rf39') await route.fulfill({ status: 502, json: { data: { message: 'CRM недоступна' } } });
      else await route.fulfill({ json: { id: source + '-draft', created: source === 'nmarket', linked: false, warnings: [] } });
      return true;
    }
    return false;
  });
  const toggle = page.getByRole('navigation', { name: 'Источник при совпадении квартиры' });
  await toggle.getByRole('button', { name: 'CRM RF39', exact: true }).click();
  await expect(toggle.getByRole('button', { name: 'CRM RF39', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const search = page.getByRole('button', { name: 'Найти и привязать квартиры', exact: true });
  await search.click();
  await expect.poll(() => imports.length).toBe(1);
  await expect(toggle.getByRole('button', { name: 'Нмаркет', exact: true })).toBeDisabled();
  if (failCrm) await heldImport!.fulfill({ status: 502, json: { data: { message: 'CRM недоступна' } } });
  else await heldImport!.fulfill({ json: { id: 'crm-draft', created: true, linked: true, warnings: [] } });
  await expect(search).toBeEnabled();
  expect(imports.map(item => item.source)).toEqual(['rf39', 'rf39', 'rf39', 'nmarket']);
  for (const imported of imports.slice(0, 3)) {
    expect(imported.body).toMatchObject({ id: 100, layoutId: 20, preferredNmarketId: 'apartment:99', preferredSource: 'rf39', complexId: complex.id });
    expect(imported.body).not.toHaveProperty('matchedNmarketIds');
  }
  expect(imports[3]!.body.id).toBe('apartment:101');
  await expect(page.locator('[data-source="rf39"] [data-count="created"]')).toHaveText(failCrm ? '0' : '1');
  await expect(page.locator('[data-source="nmarket"] [data-count="existing"]')).toHaveText(failCrm ? '0' : '2');
  await expect(page.locator('[data-source="nmarket"] [data-count="errors"]')).toHaveText(failCrm ? '2' : '0');
});
