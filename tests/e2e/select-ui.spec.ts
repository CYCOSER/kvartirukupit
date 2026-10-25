import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test';

async function checkJoined(page: Page, field: Locator, side: 'top' | 'bottom', name: string, testInfo: TestInfo) {
  const panel = page.getByRole('listbox');
  await expect(panel).toHaveAttribute('data-side', side);
  await expect(field).toHaveAttribute('data-side', side);
  await expect(field).toHaveAttribute('aria-expanded', 'true');
  await expect(panel).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(field).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  const fieldBox = (await field.boundingBox())!;
  const panelBox = (await panel.boundingBox())!;
  expect(Math.abs(fieldBox.x - panelBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(fieldBox.width - panelBox.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(side === 'bottom' ? panelBox.y - fieldBox.y - fieldBox.height : fieldBox.y - panelBox.y - panelBox.height)).toBeLessThanOrEqual(1);
  const inner = side === 'bottom' ? 'bottom' : 'top';
  const outer = side === 'bottom' ? 'top' : 'bottom';
  await expect(field).toHaveCSS(`border-${inner}-left-radius`, '0px');
  await expect(field).toHaveCSS(`border-${outer}-left-radius`, '8px');
  await expect(field).toHaveCSS(`border-${inner}-color`, 'rgba(0, 0, 0, 0)');
  await expect(panel).toHaveCSS(`border-${outer}-width`, '0px');
  await expect(panel).toHaveCSS(`border-${inner}-left-radius`, '8px');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const y = Math.min(fieldBox.y, panelBox.y);
  await page.screenshot({ path: testInfo.outputPath(name + '.png'), clip: {
    x: Math.max(0, fieldBox.x - 10), y: Math.max(0, y - 10),
    width: fieldBox.width + 20, height: fieldBox.height + panelBox.height + 20,
  } });
}

test('select menus join their field on both sides and preserve keyboard control', async ({ page }, testInfo) => {
  await page.route('**/api/admin/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/admin/me' || path === '/api/admin/login') await route.fulfill({ json: { ok: true } });
    else if (path === '/api/admin/properties') await route.fulfill({ json: [] });
    else if (path === '/api/admin/rf39/objects') await route.fulfill({ json: {
      items: ['Дома', 'ЖК', 'Квартиры'].map((category, index) => ({
        id: index + 1, title: 'Тестовый объект ' + (index + 1), category,
        location: 'Калининград', address: 'Тестовый адрес', price: 5000000,
        supported: true, existingId: null,
      })), nextOffset: null,
    } });
    else await route.fulfill({ status: 404, json: { message: 'Unexpected fixture request' } });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/admin-console-9Xk6uiIs/login');
  await page.getByLabel('Email', { exact: true }).fill('fixture@example.com');
  await page.getByLabel('Пароль', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/\/properties$/);
  await page.getByRole('link', { name: 'Импорт из CRM', exact: true }).click();
  await expect(page.getByText('Тестовый объект 1', { exact: true })).toBeVisible();
  const field = page.getByRole('combobox', { name: 'Категория CRM', exact: true, includeHidden: true });

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await field.evaluate(node => window.scrollTo({ top: node.getBoundingClientRect().top + window.scrollY - 90, behavior: 'instant' }));
    await field.focus();
    await page.keyboard.press('Enter');
    await checkJoined(page, field, 'bottom', `select-${width}-bottom`, testInfo);
    await expect(field.locator('svg')).toHaveCSS('transform', 'matrix(-1, 0, 0, -1, 0, 0)');
    await page.keyboard.press('Escape');
    await expect(field).toBeFocused();
    await expect(field).toHaveAttribute('aria-expanded', 'false');
    await expect(field).toHaveCSS('border-radius', '8px');
    await page.setViewportSize({ width, height: 400 });
    await field.evaluate(node => window.scrollTo({ top: node.getBoundingClientRect().top + window.scrollY - window.innerHeight + 75, behavior: 'instant' }));
    await field.click();
    await checkJoined(page, field, 'top', `select-${width}-top`, testInfo);
    await page.keyboard.press('Escape');
  }

  await field.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(field).toContainText('Квартиры');
  await expect(field).toBeFocused();
  await expect(page.getByText('Тестовый объект 1', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Тестовый объект 3', { exact: true })).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await field.click();
  await expect(page.getByRole('listbox')).toHaveCSS('animation-name', 'none');
  await expect(field.locator('svg')).toHaveCSS('transition-duration', '0s');
  await page.keyboard.press('Escape');
});

test('public catalog sorting keeps its blue palette and square corners', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/catalog');
  const field = page.getByRole('combobox', { name: 'Сортировка', exact: true, includeHidden: true });
  await expect(field).toHaveCSS('border-radius', '0px');
  await field.click();
  const panel = page.getByRole('listbox');
  await expect(panel).toHaveCSS('background-color', 'rgb(234, 242, 252)');
  await expect(field).toHaveCSS('background-color', 'rgb(234, 242, 252)');
  await expect(panel).toHaveCSS('border-radius', '0px');
  const box = (await field.boundingBox())!;
  const menu = (await panel.boundingBox())!;
  expect(Math.abs(box.x - menu.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.width - menu.width)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('select-public.png'), clip: {
    x: box.x - 10, y: Math.min(box.y, menu.y) - 10,
    width: box.width + 20, height: box.height + menu.height + 20,
  } });
  await page.keyboard.press('Escape');
  await expect(field).toBeFocused();
});
