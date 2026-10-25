import { test, expect } from "@playwright/test";

test("navigation returns on upward scrolling and remains usable on mobile", async ({
  page,
}) => {
  for (const width of [1440, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/catalog");
    await expect(
      page.getByRole("combobox", { name: "Сортировка" }),
    ).toContainText("Сначала новые");
    const header = page.locator(".site-header");
    await expect(header).toHaveCSS("position", "fixed");
    if (width === 1440) {
      const currentLink = page.locator('.desktop-nav a[href="/catalog"]');
      await currentLink.click();
      await expect(currentLink).toBeFocused();
    }
    await page.evaluate(() =>
      window.scrollTo({ top: 1300, behavior: "instant" }),
    );
    await expect
      .poll(() => header.evaluate((el) => el.getBoundingClientRect().bottom))
      .toBeLessThanOrEqual(1);
    await page.evaluate(() =>
      window.scrollBy({ top: -80, behavior: "instant" }),
    );
    await expect
      .poll(() => header.evaluate((el) => el.getBoundingClientRect().top))
      .toBe(0);
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(1000);
    if (width === 360) {
      await page.getByRole("button", { name: "Открыть меню" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByRole("button", { name: "Закрыть", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Открыть меню" }),
      ).toBeFocused();
      await expect
        .poll(() => header.evaluate((el) => el.getBoundingClientRect().top))
        .toBe(0);
      await page.getByRole("button", { name: "Открыть меню" }).blur();
    }
    await page.evaluate(() =>
      window.scrollBy({ top: 160, behavior: "instant" }),
    );
    await expect
      .poll(() => header.evaluate((el) => el.getBoundingClientRect().bottom))
      .toBeLessThanOrEqual(1);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await expect
      .poll(() => header.evaluate((el) => el.getBoundingClientRect().top))
      .toBe(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() =>
    window.scrollTo({ top: 1300, behavior: "instant" }),
  );
  await expect(page.locator(".site-header")).toHaveClass(/is-hidden/);
  await page.evaluate(() => window.scrollBy({ top: -80, behavior: "instant" }));
  await expect
    .poll(() =>
      page
        .locator(".site-header")
        .evaluate((el) => el.getBoundingClientRect().top),
    )
    .toBe(0);
});

test("photo header keeps one background through scrolling", async ({
  page,
}) => {
  await page.goto("/catalog/zhk-traditsiya");
  await expect(page.locator(".detail-gallery")).toBeVisible();
  await page.waitForFunction(
    () =>
      !!(
        document.getElementById("__nuxt") as HTMLElement & {
          __vue_app__?: object;
        }
      )?.__vue_app__,
  );
  const header = page.locator(".site-header");
  const background = await header.evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  expect(background).toBe("rgba(16, 47, 80, 0.86)");
  await page.evaluate(() =>
    window.scrollTo({ top: 1300, behavior: "instant" }),
  );
  await expect(header).toHaveClass(/is-hidden/);
  await page.evaluate(() => window.scrollBy({ top: -80, behavior: "instant" }));
  await expect(header).not.toHaveClass(/is-hidden/);
  expect(
    await header.evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe(background);
  await expect(header).toHaveCSS("backdrop-filter", "blur(16px)");
});
