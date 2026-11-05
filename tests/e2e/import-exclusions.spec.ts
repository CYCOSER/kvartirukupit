import { expect } from '@playwright/test';
import { test } from './fixtures/admin-session';
import { mockImportJobs } from './fixtures/import-jobs';

for (const source of ['rf39', 'nmarket'] as const) {
  const action = source === 'rf39' ? 'Опубликовать квартиры' : 'Создать черновики';
  test(`${source} exclusions remove previous selections before creating a background job`, async ({ page }, testInfo) => {
    const items = [
      { title: 'Квартира у моря', location: 'Зеленоградск', address: 'Морская, 8' },
      { title: 'Квартира у парка', location: 'Калининград', address: 'Мира, 1' },
      { title: 'Квартира с террасой', location: 'Калининград', address: 'Лесная, 7' },
      { title: 'ЖК Сосны', location: 'Пионерский', address: 'Сосновая, 4' },
    ].map((item, index) => ({
      ...item, id: source === 'rf39' ? 301 + index : `apartment:${301 + index}`,
      category: index === 3 ? 'ЖК' : 'Квартиры', price: 6000000, area: 50, bedrooms: 2,
      floors: 5, developer: 'Застройщик А', supported: true, existingId: null,
    }));
    await page.route(`**/api/admin/${source}/objects?*`, route => route.fulfill({ json: { items, nextOffset: null } }));
    const fixture = await mockImportJobs(page);
    await page.goto(`/admin-console-9Xk6uiIs/properties/import?source=${source}`);
    await page.getByRole('button', { name: 'Выбрать все найденные', exact: true }).click();
    await expect(page.getByRole('button', { name: `${action} (4)`, exact: true })).toBeEnabled();
    await page.locator('.admin-exclusions > summary').click();
    for (const city of ['Зеленоградск', 'Пионерский']) {
      await page.getByRole('combobox', { name: 'Исключить: Город', exact: true }).click();
      await page.getByRole('option', { name: city, exact: true }).click();
    }
    await page.getByRole('textbox', { name: 'Исключить по тексту', exact: true }).fill('  МИРА, 1  ;\n');
    await expect(page.getByRole('button', { name: `${action} (1)`, exact: true })).toBeEnabled();
    await expect(page.getByRole('checkbox')).toHaveCount(1);
    await expect(page.getByRole('checkbox')).toBeChecked();
    if (source === 'nmarket') {
      await page.setViewportSize({ width: 390, height: 844 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
      await page.screenshot({ path: testInfo.outputPath('import-exclusions-390.png'), fullPage: true });
    }
    // Positive filters still allow intentionally selected rows on another filtered view.
    await page.getByRole('textbox', { name: source === 'rf39' ? 'Поиск объектов CRM' : 'Поиск объектов Нмаркета', exact: true }).fill('несуществующий объект');
    await expect(page.getByText('Из них скрыто фильтрами: 1', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: `${action} (1)`, exact: true }).click();
    await expect.poll(() => fixture.requests.length).toBe(1);
    expect(fixture.requests[0]).toMatchObject({ kind: 'import', source, items: [{ id: items[2]!.id, title: items[2]!.title }] });
    await page.getByRole('button', { name: 'Сбросить фильтры', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Исключить по тексту', exact: true })).toHaveValue('');
    await expect(page.getByText('Найдено: 4', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: `${action} (0)`, exact: true })).toBeDisabled();
  });
}
