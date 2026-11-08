import { test, expect } from '@playwright/test';

test('tours page has search metadata and is reachable from both menus', async ({ page, request }, testInfo) => {
  const response = await request.get('/tours');
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain('Туры по новостройкам Калининграда и побережья');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [1440, 1101, 800, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/tours');
    await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as Element & { __vue_app__?: unknown })?.__vue_app__);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Туры\s*по новостройкам/);
    await expect(page.locator('.scene-photo')).toHaveAttribute('src', '/images/backgrounds/tours-bus.webp');
    await expect.poll(() => page.locator('.scene-photo').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    await expect(page.locator('#tour-request-title')).toHaveText(/Наш маршрут\s*Для вас/);
    await expect(page.locator('#tour-request-title .type-script')).toHaveCSS('text-decoration-line', 'none');
    await expect(page.locator('.desktop-nav').getByRole('link', { name: 'Как купить', exact: true })).toHaveCount(0);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/tours$/);
    await expect(page.locator('.footer-destinations a[href="/tours"]')).toBeVisible();
    if (width > 1100) {
      await expect(page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Туры', exact: true })).toHaveAttribute('href', '/tours');
    } else {
      await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
      await expect(page.getByRole('navigation', { name: 'Меню сайта', exact: true }).getByRole('link', { name: 'Как купить', exact: true })).toHaveCount(0);
      await page.getByRole('navigation', { name: 'Меню сайта', exact: true }).getByRole('link', { name: 'Туры по новостройкам', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (width === 1440 || width === 390) await page.screenshot({ path: testInfo.outputPath(`tours-page-${width}.png`), fullPage: true });
  }
});

test('tour requests include the selected format and preserve the comment within the server limit', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const formats = ['Калининград', 'Побережье', 'Пригород', 'Индивидуальный'];
  let enquiry: Record<string, unknown> | undefined;
  await page.route('**/api/leads', async route => {
    enquiry = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true } });
  });
  for (const [index, format] of formats.entries()) {
    await page.setViewportSize({ width: index % 2 ? 390 : 1440, height: 1000 });
    await page.goto('/tours');
    await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as Element & { __vue_app__?: unknown })?.__vue_app__);
    const form = page.locator('.lead-form');
    const formatField = form.getByRole('combobox', { name: 'Формат тура', exact: true });
    await expect(formatField).toHaveText('Калининград');
    await formatField.click();
    await expect(page.getByRole('option')).toHaveText(formats);
    await page.getByRole('option', { name: format, exact: true }).click();
    await expect(formatField).toHaveText(format);
    const phone = form.getByLabel('Номер телефона', { exact: true });
    await expect(phone).toHaveAttribute('required', '');
    await expect(form.locator('.required-hint')).toHaveText('обязательно');
    await expect(form.locator('.required-hint')).toBeVisible();
    await phone.fill('+79991234567');
    const comment = index === formats.length - 1 ? 'А'.repeat(1900) : 'Удобно в субботу после обеда';
    await expect(form.locator('textarea')).toHaveAttribute('maxlength', '1900');
    await form.locator('textarea').fill(comment);
    await expect(form.locator('.comment-hint')).toHaveText(`${comment.length} / 1900`);
    await form.getByRole('checkbox').check();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (index < 2) await form.screenshot({ path: testInfo.outputPath(`tour-form-${index % 2 ? 390 : 1440}.png`) });
    await form.getByRole('button', { name: 'Оставить заявку на тур', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Заявка принята');
    expect(enquiry?.comment).toBe(`Тур по новостройкам: ${format}.\n${comment}`);
    expect(String(enquiry?.comment).length).toBeLessThanOrEqual(2000);
    expect(enquiry?.phone).toBe('+79991234567');
    expect(enquiry?.name).toBe('');
    expect(enquiry?.purpose).toBe('buyer');
  }
});

test('regular forms mark the phone as required and keep the original request contents', async ({ page }) => {
  let enquiry: Record<string, unknown> | undefined;
  await page.route('**/api/leads', async route => {
    enquiry = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true } });
  });
  for (const path of ['/', '/ipoteka']) {
    await page.goto(path);
    await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as Element & { __vue_app__?: unknown })?.__vue_app__);
    const form = page.locator('.lead-form');
    await expect(form.locator('.required-hint')).toHaveText('обязательно');
    await expect(form.getByLabel('Номер телефона', { exact: true })).toHaveAttribute('required', '');
    await expect(form.locator('textarea')).toHaveAttribute('maxlength', '2000');
    await expect(form.getByRole('combobox')).toHaveCount(0);
    await form.getByLabel('Номер телефона', { exact: true }).fill('+79991234567');
    await form.locator('textarea').fill('Хочу посмотреть квартиру');
    await form.getByRole('checkbox').check();
    await form.getByRole('button', { name: 'Обсудить подбор', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Заявка принята');
    expect(enquiry?.comment).toBe('Хочу посмотреть квартиру');
  }
});
