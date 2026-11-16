import { test, expect } from '@playwright/test';
import { mockCaptcha, solveCaptcha } from './fixtures/captcha';

test('lead submissions require a current captcha and reset it after a rejected request', async ({ page }) => {
  await mockCaptcha(page);
  let attempts = 0;
  await page.route('**/api/leads', async route => {
    attempts++;
    expect(route.request().postDataJSON().captchaToken).toMatch(/^test-captcha-token-/);
    await route.fulfill(attempts === 1
      ? { status: 403, json: { statusMessage: 'Captcha verification failed' } }
      : { json: { ok: true } });
  });
  await page.goto('/tours');
  const form = page.locator('.lead-form');
  const submit = form.locator('button[type="submit"]');
  await form.getByLabel('Номер телефона', { exact: true }).fill('+79991234567');
  await form.locator('.consent input').check();
  await expect(submit).toBeDisabled();
  await solveCaptcha(page);
  await expect(submit).toBeEnabled();
  await page.evaluate(() => (window as any).__captchaTest.emit('token-expired'));
  await expect(submit).toBeDisabled();
  await expect(form.getByRole('alert')).toContainText('Срок проверки истёк');
  await solveCaptcha(page);
  await submit.click();
  await expect(form.getByRole('alert')).toContainText('Пройдите проверку ещё раз');
  await expect(submit).toBeDisabled();
  expect(attempts).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as any).__captchaTest.resets)).toBe(2);
  await solveCaptcha(page);
  await form.evaluate((element: HTMLFormElement) => {
    element.requestSubmit();
    element.requestSubmit();
  });
  await expect(page.getByRole('status')).toContainText('Заявка принята');
  expect(attempts).toBe(2);
  await expect.poll(() => page.evaluate(() => (window as any).__captchaTest.destroyed)).toBe(1);
});

test('captcha load and widget errors can be retried while preserving the enquiry', async ({ page }) => {
  await mockCaptcha(page, true);
  await page.goto('/tours');
  const form = page.locator('.lead-form');
  const submit = form.locator('button[type="submit"]');
  await form.getByLabel('Номер телефона', { exact: true }).fill('+79991234567');
  await expect(form.getByRole('alert')).toContainText('Не удалось загрузить проверку');
  await expect(submit).toBeDisabled();
  await form.getByRole('button', { name: 'Повторить проверку' }).click();
  await solveCaptcha(page);
  await expect(submit).toBeEnabled();
  for (const width of [320, 360, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect.poll(async () => {
      const widget = await form.locator('.captcha-widget').boundingBox();
      const frame = await form.locator('.captcha-frame').boundingBox();
      return Math.abs(widget!.width - frame!.width);
    }).toBeLessThan(1);
  }
  await page.evaluate(() => (window as any).__captchaTest.emit('network-error'));
  await expect(submit).toBeDisabled();
  await form.getByRole('button', { name: 'Повторить проверку' }).click();
  await solveCaptcha(page);
  await expect(submit).toBeEnabled();
  await expect(form.getByLabel('Номер телефона', { exact: true })).toHaveValue('+79991234567');
  await page.locator('.desktop-nav a[href="/ipoteka"]').click();
  await expect(page).toHaveURL(/\/ipoteka$/);
  await expect(page.locator('.lead-form-kicker')).toHaveText('Личный подбор');
  await solveCaptcha(page);
  await expect(page.locator('.lead-form button[type="submit"]')).toBeEnabled();
});
