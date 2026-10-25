import { test, expect } from "@playwright/test";

test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

test("sorting keeps the fixed background and page layout still", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/catalog");
  const sorting = page.getByRole("combobox", {
    name: "Сортировка",
    includeHidden: true,
  });
  await sorting.scrollIntoViewIfNeeded();
  const before = await page.locator(".catalog-page").evaluate((element) => ({
    backgroundWidth: getComputedStyle(element, "::before").width,
    bodyOverflow: document.body.style.overflow,
    bodyPadding: document.body.style.paddingRight,
    viewportWidth: document.documentElement.clientWidth,
    scrollY: window.scrollY,
  }));
  const triggerBefore = await sorting.boundingBox();

  await sorting.click();
  const menu = page.getByRole("listbox");
  await expect(menu).toBeVisible();
  const openBackground = await sorting.evaluate((element) => getComputedStyle(element).backgroundColor);
  await expect(menu).toHaveCSS("background-color", openBackground);
  const menuBox = (await menu.boundingBox())!;
  expect(Math.abs(menuBox.x - triggerBefore!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(menuBox.width - triggerBefore!.width)).toBeLessThanOrEqual(1);
  const edgeGap = Math.min(
    Math.abs(menuBox.y - triggerBefore!.y - triggerBefore!.height),
    Math.abs(triggerBefore!.y - menuBox.y - menuBox.height),
  );
  expect(edgeGap, "The open menu must join the trigger without a gap").toBeLessThanOrEqual(1);
  const after = await page.locator(".catalog-page").evaluate((element) => ({
    backgroundWidth: getComputedStyle(element, "::before").width,
    bodyOverflow: document.body.style.overflow,
    bodyPadding: document.body.style.paddingRight,
    viewportWidth: document.documentElement.clientWidth,
    scrollY: window.scrollY,
  }));
  expect(after).toEqual(before);
  expect(await sorting.boundingBox()).toEqual(triggerBefore);

  await page.keyboard.press("Escape");
  await expect(sorting).toBeFocused();
  await sorting.press("ArrowDown");
  await page.getByRole("option", { name: "Сначала дешевле", exact: true }).click();
  await expect(page).toHaveURL(/sort=price_asc/);
});

test("property cards have one link covering text and price, with keyboard access", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/catalog");
  const card = page.locator(".property-card").first();
  await expect(card).toHaveJSProperty("tagName", "A");
  await expect(card.locator("a")).toHaveCount(0);
  const href = await card.getAttribute("href");
  expect(href).toMatch(/^\/catalog\/[^/]+$/);
  const title = await card.locator("h3").innerText();
  await expect(card).toHaveAccessibleName(title);
  await card.locator(".card-price").click();
  await expect(page).toHaveURL((url) => url.pathname === href);

  await page.goto("/catalog");
  await card.focus();
  await expect(card).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL((url) => url.pathname === href);

  await page.goto("/");
  const clones = page.locator(".property-carousel .property-card[inert]");
  await expect(clones.first()).toHaveAttribute("aria-hidden", "true");
  await expect(clones.first()).toHaveJSProperty("tagName", "A");
  await expect(clones.first().locator("a")).toHaveCount(0);
});

test("modal filters preserve the page width and restore scrolling on close", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/catalog");
  const trigger = page.getByRole("button", {
    name: "Фильтры",
    exact: true,
    includeHidden: true,
  });
  await trigger.scrollIntoViewIfNeeded();
  const before = await page.locator(".catalog-page").evaluate((element) => ({
    backgroundWidth: getComputedStyle(element, "::before").width,
    bodyWidth: document.body.getBoundingClientRect().width,
    pageWidth: element.getBoundingClientRect().width,
    scrollY: window.scrollY,
  }));
  const triggerBefore = await trigger.boundingBox();
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await expect(page.locator("body")).toHaveCSS("padding-right", "0px");
  const after = await page.locator(".catalog-page").evaluate((element) => ({
    backgroundWidth: getComputedStyle(element, "::before").width,
    bodyWidth: document.body.getBoundingClientRect().width,
    pageWidth: element.getBoundingClientRect().width,
    scrollY: window.scrollY,
  }));
  expect(after).toEqual(before);
  expect(await trigger.boundingBox()).toEqual(triggerBefore);
  await dialog.getByRole("combobox").first().click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await page.keyboard.press("Escape");
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await dialog.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
  await expect(trigger).toBeFocused();
  expect(await trigger.boundingBox()).toEqual(triggerBefore);
});
