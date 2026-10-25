import { test, expect } from "@playwright/test";

const carousels = [
  { url: "/", region: ".property-carousel", arrow: ".carousel-arrow" },
  {
    url: "/catalog/zhk-tikhiy-dom",
    region: ".gallery-carousel",
    arrow: ".gallery-arrow",
  },
];

test("compact carousel controls appear on hover and keyboard focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 900 });

  for (const { url, region, arrow } of carousels) {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(url);
    const carousel = page.locator(region);
    const controls = carousel.locator(arrow);
    await expect(controls).toHaveCount(2);
    await carousel.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);

    for (const control of await controls.all()) {
      await expect(control).toHaveCSS("width", "36px");
      await expect(control).toHaveCSS("height", "36px");
      await expect(control).toHaveCSS("opacity", "0");
      await expect(control).toHaveCSS("pointer-events", "none");
    }

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(controls.first()).not.toHaveCSS("transition-duration", "0s");
    await carousel.hover();
    for (const control of await controls.all()) {
      await expect(control).toHaveCSS("opacity", "1");
      await expect(control).toHaveCSS("pointer-events", "auto");
    }

    await page.mouse.move(0, 0);
    await expect(controls.first()).toHaveCSS("opacity", "0");
    await controls.first().focus();
    await page.keyboard.press("Tab");
    await expect(controls.last()).toBeFocused();
    await expect(controls.last()).toHaveCSS("opacity", "1");
    await expect(controls.last()).toHaveCSS("pointer-events", "auto");

    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const control of await controls.all()) {
      await expect(control).toHaveCSS("transition-duration", "0s");
    }
  }

  const thumbs = page.locator(".gallery-thumbs");
  const photos = thumbs.getByRole("button");
  const photoCount = await photos.count();
  expect(photoCount).toBeGreaterThanOrEqual(9);
  await expect(thumbs).toHaveCSS("scrollbar-width", "none");
  expect(
    await thumbs.evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(true);
  await thumbs.evaluate((element) =>
    element.scrollTo({ left: element.scrollWidth, behavior: "instant" }),
  );
  expect(await thumbs.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await photos.last().click();
  await expect(photos.last()).toHaveAttribute("aria-pressed", "true");
  const lastPhoto = String(photoCount).padStart(2, "0");
  await expect(page.locator(".detail-image-count")).toHaveText(
    `${lastPhoto} / ${lastPhoto}`,
  );
});

test("touch carousel controls stay visible with a 44px target", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    hasTouch: true,
    viewport: { width: 900, height: 900 },
    reducedMotion: "reduce",
  });
  try {
    const page = await context.newPage();
    for (const { url, region, arrow } of carousels) {
      await page.goto(url);
      const carousel = page.locator(region);
      await carousel.scrollIntoViewIfNeeded();
      const controls = carousel.locator(arrow);
      await expect(controls).toHaveCount(2);
      for (const control of await controls.all()) {
        await expect(control).toHaveCSS("width", "44px");
        await expect(control).toHaveCSS("height", "44px");
        await expect(control).toHaveCSS("opacity", "1");
        await expect(control).toHaveCSS("pointer-events", "auto");
      }
    }
  } finally {
    await context.close();
  }
});
