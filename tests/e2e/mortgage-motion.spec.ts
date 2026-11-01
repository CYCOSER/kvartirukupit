import { test, expect, type Locator } from "@playwright/test";

async function expectOpen(section: Locator) {
  await expect.poll(() => section.evaluate((el) =>
    Math.abs(el.getBoundingClientRect().height - (el.firstElementChild as HTMLElement).offsetHeight),
  )).toBeLessThan(1);
}

for (const width of [390, 1440]) {
  test(`mortgage entrance and unfolding work with scrolling and anchors at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.addInitScript(() => {
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (frames, options) {
        if (this.matches(".mortgage-page .scene-panel h1")) {
          this.setAttribute("data-entrances", String(Number(this.getAttribute("data-entrances") || 0) + 1));
        }
        return animate.call(this, frames, options);
      };
    });
    await page.goto("/ipoteka");
    await page.evaluate(() => document.fonts.ready);
    const section = page.locator(".mortgage-unfold");
    await expect(page.locator("h1")).toHaveAttribute("data-entrances", "1");
    await expect(section).toHaveCSS("height", "0px");
    await section.evaluate(el => window.scrollTo({
      top: scrollY + el.getBoundingClientRect().top - innerHeight / 2 - 40,
      behavior: "instant",
    }));
    await page.evaluate(() => new Promise<void>(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    ));
    await expect(section).toHaveCSS("height", "0px");
    await page.evaluate(() => window.scrollBy({ top: 80, behavior: "instant" }));
    await expectOpen(section);
    await expect(page.locator("#mortgage .mortgage-payment")).toHaveText("0 ₽");
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await expectOpen(section);
    await expect(page.locator("h1")).toHaveAttribute("data-entrances", "1");

    await page.goto("/ipoteka");
    await expect(section).toHaveCSS("height", "0px");
    await page.getByRole("link", { name: "Рассчитать платёж ↓" }).click();
    await expect(page).toHaveURL(/#mortgage$/);
    await expectOpen(section);
    await expect.poll(() => page.locator("#mortgage").evaluate(el => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0);
    await expect.poll(() => page.locator("#mortgage").evaluate(el => el.getBoundingClientRect().top)).toBeLessThan(100);
    await page.setViewportSize({ width: width === 390 ? 1440 : 390, height: 800 });
    await expectOpen(section);

    await page.goto("/ipoteka");
    await expect(section).toHaveCSS("height", "0px");
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    await expectOpen(section);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - innerHeight - scrollY)).toBeLessThanOrEqual(2);

    await page.goto("/ipoteka#mortgage");
    await expectOpen(section);
    await expect(page.getByLabel("Стоимость квартиры, ₽", { exact: true })).toBeVisible();
  });
}

test("mortgage content stays visible with reduced motion and without JavaScript", async ({ page, browser }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/ipoteka");
  await expectOpen(page.locator(".mortgage-unfold"));
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const noJs = await context.newPage();
    await noJs.goto(new URL("/ipoteka#mortgage", page.url()).href);
    await expectOpen(noJs.locator(".mortgage-unfold"));
    await expect(noJs.locator("#mortgage .mortgage-payment")).toHaveText("0 ₽");
  } finally {
    await context.close();
  }
});
