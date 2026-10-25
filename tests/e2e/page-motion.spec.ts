import { test, expect } from "@playwright/test";

test("catalog cards enter once on first visibility and finish independently of scrolling", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      const animation = animate.call(this, keyframes, options);
      if (this.matches(".catalog-panel")) {
        this.setAttribute(
          "data-entrances",
          String(Number(this.getAttribute("data-entrances") || 0) + 1),
        );
        this.setAttribute(
          "data-time-driven",
          String(animation.timeline === document.timeline),
        );
        animation.addEventListener("finish", () =>
          this.setAttribute("data-entrance-finished", "true"),
        );
      }
      return animation;
    };
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto("/catalog");
  const cards = page.locator(".catalog-panels .catalog-panel");
  const lastCard = cards.last();
  expect(
    await lastCard.evaluate(
      (el) => el.getBoundingClientRect().top > innerHeight,
    ),
  ).toBeTruthy();
  await expect(lastCard).not.toHaveAttribute("data-entrances");
  expect(await lastCard.evaluate((el) => el.getAnimations().length)).toBe(0);
  await lastCard.scrollIntoViewIfNeeded();
  await expect(lastCard).toHaveAttribute("data-entrances", "1");
  await expect(lastCard).toHaveAttribute("data-time-driven", "true");
  const scrollPosition = await page.evaluate(() => scrollY);
  await expect(lastCard).toHaveAttribute("data-entrance-finished", "true");
  expect(await page.evaluate(() => scrollY)).toBe(scrollPosition);
  expect(await lastCard.evaluate((el) => getComputedStyle(el).opacity)).toBe(
    "1",
  );
  expect(
    await lastCard.evaluate(
      (el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).m42,
    ),
  ).toBe(0);

  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect
    .poll(() =>
      lastCard.evaluate((el) => el.getBoundingClientRect().top > innerHeight),
    )
    .toBeTruthy();
  await lastCard.scrollIntoViewIfNeeded();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await expect(lastCard).toHaveAttribute("data-entrances", "1");
  expect(await lastCard.evaluate((el) => el.getAnimations().length)).toBe(0);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await lastCard.scrollIntoViewIfNeeded();
  await expect(lastCard).not.toHaveAttribute("data-entrances");
  expect(
    await cards.evaluateAll((elements) =>
      elements.every((el) => el.getAnimations().length === 0),
    ),
  ).toBeTruthy();
});

test("entrance animations never dim already rendered images", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  for (const [path, selector] of [
    ["/", ".hero-backdrop"],
    ["/catalog", ".catalog-invitation-image img"],
    ["/blog", ".scene-photo"],
  ]) {
    await page.goto(path);
    const image = page.locator(selector).first();
    await image.scrollIntoViewIfNeeded();
    const staysOpaque = await image.evaluate(async (element) => {
      for (let frame = 0; frame < 90; frame++) {
        let node: Element | null = element;
        while (node) {
          if (Number(getComputedStyle(node).opacity) < 0.99) return false;
          node = node.parentElement;
        }
        await new Promise(requestAnimationFrame);
      }
      return true;
    });
    expect(staysOpaque).toBeTruthy();
  }
});

test("inner-page motion leaves controls stable and honors reduced motion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const path of [
    "/catalog",
    "/catalog/zhk-tikhiy-dom",
    "/blog",
    "/privacy",
  ]) {
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/catalog");
  await page.locator(".catalog-panel").last().scrollIntoViewIfNeeded();
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .some(
        (a) =>
          a.effect instanceof KeyframeEffect &&
          a.effect.target?.classList.contains("catalog-panel"),
      ),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(() => page.evaluate(() => document.getAnimations().length))
    .toBe(0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/catalog/zhk-tikhiy-dom");
  await page.getByLabel("Ваше имя").fill("Проверка анимаций");
  expect(
    await page
      .locator(".lead-form")
      .evaluate((el) =>
        el.getAnimations({ subtree: true }).flatMap((animation) =>
          (animation.effect as KeyframeEffect).getKeyframes().flatMap((frame) =>
            Object.keys(frame).filter(
              (property) =>
                !["offset", "computedOffset", "easing", "composite", "color"].includes(property) &&
                !property.endsWith("Color"),
            ),
          ),
        ),
      ),
  ).toEqual([]);
  await expect(page.getByLabel("Ваше имя")).toHaveValue("Проверка анимаций");
  await page.locator(".breadcrumb").getByRole("link", { name: "Новостройки", exact: true }).click();
  await expect(page).toHaveURL(/\/catalog$/);
  await expect(page.locator(".property-card").first()).toBeVisible();
});
