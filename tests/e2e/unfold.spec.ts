import { test, expect, type Page } from "@playwright/test";

const sections = ["#collection", "#process"];

async function scrollFrames(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }));
}

async function expectOpen(page: Page, selector: string) {
  await expect.poll(() => page.locator(selector).evaluate((element) => {
    const content = element.firstElementChild as HTMLElement;
    return content.offsetHeight > 0 && Math.abs(element.getBoundingClientRect().height - content.offsetHeight) < 1;
  })).toBe(true);
}

for (const width of [390, 1440]) {
  test(`homepage sections open once at the midpoint and survive fast scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator(".home-intro")).toBeHidden();
    for (const selector of sections) await expect(page.locator(selector)).toHaveCSS("height", "0px");

    for (const selector of sections) {
      const section = page.locator(selector);
      await section.evaluate((element) => window.scrollTo({
        top: scrollY + element.getBoundingClientRect().top - innerHeight / 2 - 40,
        behavior: "instant",
      }));
      await scrollFrames(page);
      await expect(section).toHaveCSS("height", "0px");
      await page.evaluate(() => window.scrollBy({ top: 80, behavior: "instant" }));
      await expectOpen(page, selector);
    }
    for (const destination of ["bottom", "top"]) {
      await page.evaluate((destination) => window.scrollTo({
        top: destination === "bottom" ? document.documentElement.scrollHeight : 0,
        behavior: "instant",
      }), destination);
      await scrollFrames(page);
      for (const selector of sections) await expectOpen(page, selector);
    }

    await page.reload();
    await expect(page.locator(".home-intro")).toBeHidden();
    for (const selector of sections) await expect(page.locator(selector)).toHaveCSS("height", "0px");
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    await scrollFrames(page);
    for (const selector of sections) await expectOpen(page, selector);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - innerHeight - scrollY)).toBeLessThanOrEqual(2);

    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await scrollFrames(page);
    await page.reload();
    await expect(page.locator(".home-intro")).toBeHidden();
    await expect(page.locator("#collection")).toHaveCSS("height", "0px");
    const interruptedOpening = await page.locator("#collection").evaluate(async (element) => {
      window.scrollTo({ top: scrollY + element.getBoundingClientRect().top - innerHeight / 2 + 40, behavior: "instant" });
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      });
      const height = element.getBoundingClientRect().height;
      const inProgress = height > 0 && height < (element.firstElementChild as HTMLElement).offsetHeight;
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
      return inProgress;
    });
    expect(interruptedOpening).toBe(true);
    for (const selector of sections) await expectOpen(page, selector);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - innerHeight - scrollY)).toBeLessThanOrEqual(2);
  });
}

test("anchors preserve open sections, a new homepage visit resets them, and motion or size changes never clip content", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator(".home-intro")).toBeHidden();
  for (const selector of sections) await expect(page.locator(selector)).toHaveCSS("height", "0px");

  await page.locator(".desktop-nav").getByRole("link", { name: "Как купить", exact: true }).click();
  await expect(page).toHaveURL(/\/#process$/);
  for (const selector of sections) await expectOpen(page, selector);
  await page.locator(".hero-scroll").click();
  await expect(page).toHaveURL(/\/#collection$/);
  await scrollFrames(page);
  for (const selector of sections) await expectOpen(page, selector);

  await page.getByRole("link", { name: "Открыть коллекцию", exact: true }).click();
  await expect(page).toHaveURL(/\/catalog$/);
  await page.getByRole("link", { name: "Квартирукупить — главная", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(".home-intro")).toBeHidden();
  for (const selector of sections) await expect(page.locator(selector)).toHaveCSS("height", "0px");

  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const selector of sections) await expectOpen(page, selector);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await scrollFrames(page);
  for (const selector of sections) await expectOpen(page, selector);
  await page.setViewportSize({ width: 390, height: 800 });
  for (const selector of sections) await expectOpen(page, selector);
  const content = page.locator("#process > .unfold-content");
  const previousHeight = await content.evaluate((element) => (element as HTMLElement).offsetHeight);
  await content.evaluate((element) => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "Дополнительный текст, загруженный после раскрытия секции. ".repeat(60);
    element.append(paragraph);
  });
  await expect.poll(() => content.evaluate((element) => (element as HTMLElement).offsetHeight)).toBeGreaterThan(previousHeight);
  await expectOpen(page, "#process");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
