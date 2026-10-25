import { test, expect } from "@playwright/test";

test("homepage intro reveals the site and respects reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const intro = page.locator(".home-intro");
    await expect(page.locator(".home-intro-title")).toHaveText(
      "Квартирукупить",
    );
    await expect(intro).toHaveAttribute("aria-hidden", "true");
    await expect(intro).toHaveAttribute("inert", "");
    await page.evaluate(() => document.fonts.ready);
    await intro.evaluate((element) => {
      for (const animation of element.getAnimations({ subtree: true })) {
        animation.pause();
        animation.currentTime = 100;
      }
    });
    expect(
      await page.locator(".home-intro-title").evaluate((element) => {
        const house = element.firstElementChild!.getBoundingClientRect();
        const viewport = document.documentElement.getBoundingClientRect();
        const tail = element
          .querySelector(".home-intro-tail")!
          .getBoundingClientRect();
        return (
          Math.abs((house.left + house.right - viewport.left - viewport.right) / 2) < 1 &&
          tail.right <= house.right + 1
        );
      }),
    ).toBe(true);
    // It slides from behind Квартиру at full opacity; only its left edge is masked.
    for (const time of [350, 450, 650, 850]) {
      await intro.evaluate((element, time) => {
        for (const animation of element.getAnimations({ subtree: true }))
          animation.currentTime = time;
      }, time);
      await expect(page.locator(".home-intro-tail")).toHaveCSS("opacity", "1");
      expect(
        await page.locator(".home-intro-tail").evaluate((element) => {
          const text = document.createRange();
          text.selectNodeContents(element);
          const bounds = text.getBoundingClientRect();
          for (
            let parent = element.parentElement;
            parent;
            parent = parent.parentElement
          ) {
            if (
              /hidden|clip|auto|scroll/.test(getComputedStyle(parent).overflowX)
            ) {
              const clip = parent.getBoundingClientRect();
              if (bounds.right > clip.right + 1) return false;
            }
          }
          return bounds.right <= innerWidth;
        }),
      ).toBe(true);
      if (time === 450)
        await page.screenshot({
          path: `test-results/intro-slide-${width}.png`,
        });
    }
    await intro.evaluate((element) => {
      for (const animation of element.getAnimations({ subtree: true }))
        animation.currentTime = 1000;
    });
    await expect(page.locator(".home-intro-tail")).toHaveCSS(
      "transform",
      "matrix(1, 0, 0, 1, 0, 0)",
    );
    await expect(page.locator(".home-intro-dash")).toHaveCSS(
      "color",
      "rgb(184, 212, 244)",
    );
    expect(
      await intro.evaluate(
        (element) => getComputedStyle(element).pointerEvents,
      ),
    ).toBe("none");
    expect(
      await page.locator(".home-intro-title").evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.left >= 0 && bounds.right <= innerWidth;
      }),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: `test-results/intro-${width}.png` });
    await intro.evaluate((element) => {
      for (const animation of element.getAnimations({ subtree: true }))
        animation.currentTime = 1150;
    });
    await expect(page.locator(".home-intro-content")).toHaveCSS("opacity", "1");
    expect(
      await intro.evaluate(
        (element) => getComputedStyle(element, "::before").transform,
      ),
    ).toBe("none");
    await intro.evaluate((element) => {
      for (const animation of element.getAnimations({ subtree: true }))
        animation.currentTime = 2150;
    });
    await expect(intro).toBeHidden();
    await expect(
      page.getByRole("link", { name: "Квартирукупить — главная" }),
    ).toBeVisible();
    await page.screenshot({ path: `test-results/hero-${width}.png` });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(page.locator(".home-intro")).toBeHidden();
  expect(
    await page
      .locator(".home-intro")
      .evaluate((element) => element.getAnimations({ subtree: true }).length),
  ).toBe(0);
  await page.goto("/catalog");
  await expect(page.locator(".home-intro")).toHaveCount(0);
});
