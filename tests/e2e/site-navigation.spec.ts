import { test, expect } from '@playwright/test';
import { propertyFixture } from './fixtures/property';

for (const width of [390, 900]) {
  test(`site menu and footer stay accessible at ${width}px`, async ({ page }, testInfo) => {
    const complex = propertyFixture({ id: 'navigation-complex', slug: 'navigation-complex', title: 'ЖК для проверки меню', type: 'complex', housingMarket: null });
    await page.addInitScript(() => localStorage.setItem('site-analytics-consent', 'necessary'));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/api/properties?*', route => route.fulfill({ json: { items: [complex], total: 1, pages: 1, locations: ['Калининград'] } }));
    await page.route(`**/api/properties/${complex.slug}`, route => route.fulfill({ json: complex }));
    await page.goto('/');
    await page.waitForFunction(() => (document.querySelector('#__nuxt') as Element & { __vue_app__?: { config: { globalProperties: { $nuxt?: { isHydrating: boolean } } } } })?.__vue_app__?.config.globalProperties.$nuxt?.isHydrating === false);
    await page.evaluate(() => document.fonts.ready);
    for (const text of await page.locator('.type-script').allTextContents()) expect(text.trim()).toMatch(/^[A-ZА-ЯЁ]/u);

    const trigger = page.getByRole('button', { name: 'Открыть меню', exact: true });
    const dialog = page.getByRole('dialog');
    const navigation = page.getByRole('navigation', { name: 'Меню сайта', exact: true });
    await trigger.click();
    await expect(dialog).toBeVisible();
    const links = [
      ['/catalog', 'Новостройки'], ['/elite', 'Готовые квартиры'],
      ['/tours', 'Туры по новостройкам'], ['/ipoteka', 'Ипотека'],
      ['/blog', 'Блог'], ['/#contact', 'Контакты'],
    ];
    await expect(navigation.getByRole('link')).toHaveCount(links.length);
    await expect(dialog.locator('svg.lucide-arrow-up-right')).toHaveCount(0);
    await expect(navigation.locator('.menu-link-icon')).toHaveCount(links.length);
    for (const [href, name] of links) {
      const link = navigation.getByRole('link', { name, exact: true });
      await expect(link).toHaveAttribute('href', href);
      await expect(link).toBeInViewport();
      await expect(link).toHaveAttribute('aria-current', 'false');
    }
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect.poll(() => dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`menu-${width}.png`) });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();

    const footer = page.locator('.site-footer');
    await footer.scrollIntoViewIfNeeded();
    const footerTitle = footer.locator('.footer-brand-group > p.type-pair');
    await expect(footerTitle.locator(':scope > .type-upright')).toHaveText('Ваше пространство');
    await expect(footerTitle.locator(':scope > .type-upright')).toHaveCSS('font-family', /Manrope/);
    await expect(footerTitle.locator(':scope > em.type-script.footer-script')).toHaveText('Ваш Калининград');
    await expect(footerTitle.locator(':scope > em.type-script.footer-script')).toHaveCSS('font-family', /Miama Nueva/);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await footer.screenshot({ path: testInfo.outputPath(`footer-${width}.png`) });

    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await trigger.click();
    await navigation.locator('a[href="/catalog"]').click();
    await expect(page).toHaveURL(/\/catalog$/);
    await expect(dialog).toHaveCount(0);
    await trigger.click();
    await expect(navigation.locator('a[href="/catalog"]')).toHaveAttribute('aria-current', 'page');
    await expect(navigation.locator('a[href="/#contact"]')).toHaveAttribute('aria-current', 'false');
    await page.keyboard.press('Escape');
    await page.locator(`.catalog-grid a[href="/catalog/${complex.slug}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/catalog/${complex.slug}$`));
    await trigger.click();
    await expect(navigation.locator('a[href="/catalog"]')).toHaveAttribute('aria-current', 'page');
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  });
}
