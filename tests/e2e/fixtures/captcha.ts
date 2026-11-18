import type { Page } from '@playwright/test';

export async function mockCaptcha(page: Page, failFirstLoad = false) {
  await page.addInitScript(() => {
    localStorage.setItem('site-analytics-consent', 'accepted');
  });
  let loads = 0;
  await page.route('https://smartcaptcha.cloud.yandex.ru/captcha.js**', async route => {
    loads++;
    if (failFirstLoad && loads === 1) return route.abort();
    await route.fulfill({
      contentType: 'application/javascript',
      body: `
        const style = document.createElement('style');
        style.textContent = '.smart-captcha { min-width: 300px; height: 118px; }';
        document.head.append(style);
        const widgets = new Map();
        let nextId = 0;
        window.__captchaTest = {
          resets: 0,
          destroyed: 0,
          emit(event) {
            for (const widget of widgets.values()) widget.events[event]?.();
          },
        };
        window.smartCaptcha = {
          render(container, options) {
            const id = nextId++;
            container.classList.add('smart-captcha');
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = 'Пройти тестовую капчу';
            button.dataset.testid = 'solve-captcha';
            button.onclick = () => options.callback('test-captcha-token-' + id);
            container.append(button);
            widgets.set(id, { container, events: {} });
            return id;
          },
          subscribe(id, event, callback) {
            widgets.get(id).events[event] = callback;
            return () => delete widgets.get(id)?.events[event];
          },
          reset() { window.__captchaTest.resets++; },
          destroy(id) {
            widgets.get(id)?.container.replaceChildren();
            widgets.delete(id);
            window.__captchaTest.destroyed++;
          },
        };
        window.onLeadCaptchaLoad();
      `,
    });
  });
}

export async function solveCaptcha(page: Page) {
  await page.getByTestId('solve-captcha').click();
}
