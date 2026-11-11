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
    const symbol = intro.locator(".home-intro-symbol");
    await expect(symbol.locator("rect")).toHaveCount(0);
    await expect(symbol.locator("path")).toHaveCount(2);
    await expect(symbol.locator("path").first()).toHaveCSS("fill", "rgb(122, 167, 237)");
    await expect(symbol.locator("path").last()).toHaveCSS("fill", "rgb(184, 212, 244)");
    const arrows = symbol.locator(".home-intro-arrow");
    await expect(arrows).toHaveCount(2);
    for (const arrow of await arrows.all()) {
      await expect(arrow).toHaveCSS("animation-duration", "0.65s");
      await expect(arrow).toHaveCSS("animation-delay", "0.3s");
      await expect(arrow).toHaveCSS("animation-timing-function", "cubic-bezier(0.22, 1, 0.36, 1)");
    }
    const arrowOffsets = () => arrows.evaluateAll((elements) =>
      elements.map((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m41),
    );
    await page.evaluate(() => document.fonts.ready);
    await intro.evaluate((element) => {
      for (const animation of element.getAnimations({ subtree: true })) {
        animation.pause();
        animation.currentTime = 100;
      }
    });
    expect(await arrowOffsets()).toEqual([4, -4]);
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
    const symbolStart = (await symbol.boundingBox())!;
    let previousArrowOffset = 4;
    // It slides from behind Квартиру at full opacity; only its left edge is masked.
    for (const time of [350, 450, 650, 850]) {
      await intro.evaluate((element, time) => {
        for (const animation of element.getAnimations({ subtree: true }))
          animation.currentTime = time;
      }, time);
      const symbolFrame = (await symbol.boundingBox())!;
      expect(symbolFrame.x).toBeCloseTo(symbolStart.x, 3);
      expect(symbolFrame.y).toBeCloseTo(symbolStart.y, 3);
      const [leftOffset, rightOffset] = await arrowOffsets();
      expect(leftOffset).toBeGreaterThan(0);
      expect(leftOffset).toBeLessThan(previousArrowOffset);
      expect(rightOffset).toBeCloseTo(-leftOffset, 5);
      previousArrowOffset = leftOffset;
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
    expect(await arrowOffsets()).toEqual([0, 0]);
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
