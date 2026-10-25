import { test, expect } from "@playwright/test";

test("desktop navigation opens the separate elite catalog and returns to new builds", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/catalog");

  const navigation = page.getByRole("navigation", { name: "Основная навигация" });
  await expect(navigation.getByRole("link")).toHaveText([
    "Элитные квартиры", "Новостройки", "Как купить", "Блог",
  ]);
  await expect(navigation.getByRole("link").first()).toHaveAttribute("href", "/elite");
  await expect(navigation.locator('a[href="/#location"]')).toHaveCount(0);

  const eliteResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/properties",
  );
  await navigation.getByRole("link", { name: "Элитные квартиры", exact: true }).click();
  const response = await eliteResponse;
  expect(response.ok()).toBeTruthy();
  expect(new URL(response.url()).searchParams.get("elite")).toBe("true");
  expect(new URL(response.url()).searchParams.get("type")).toBe("apartment");
  await expect(page).toHaveURL(/\/elite$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Элитные\s*квартиры/);
  await expect(page.locator(".glass-photo-layout")).toBeVisible();
  await expect(page.locator(".catalog-type-links button")).toHaveText(["Все квартиры"]);
  await expect(page.locator(".property-card")).toHaveCount((await response.json()).items.length);

  await navigation.getByRole("link", { name: "Новостройки", exact: true }).click();
  await expect(page).toHaveURL(/\/catalog$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Новостройки\s*Калининграда/);
  await expect(page.locator(".catalog-type-links button")).toHaveText(["Жилые комплексы", "Квартиры"]);
});

test("mobile navigation puts elite apartments first", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/catalog");
  await expect(page.locator(".header-catalog")).toHaveText("Новостройки");
  await page.getByRole("button", { name: "Открыть меню", exact: true }).click();
  const navigation = page.getByRole("navigation", { name: "Меню сайта", exact: true });
  await expect(navigation.getByRole("link").first()).toHaveAttribute("href", "/elite");
  await expect(navigation.getByRole("link", { name: "Новостройки", exact: true })).toHaveAttribute("href", "/catalog");
  await expect(navigation.locator('a[href="/#location"]')).toHaveCount(0);
  await navigation.getByRole("link", { name: "Элитные квартиры", exact: true }).click();
  await expect(page).toHaveURL(/\/elite$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test("catalog scopes survive conflicting query parameters, filter apply, and reset", async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });

  for (const elite of [true, false]) {
    const path = elite ? "/elite" : "/catalog";
    await page.goto(`${path}?elite=${!elite}&type=complex`);

    const expectedResponse = await request.get(
      `/api/properties?elite=${elite}&type=${elite ? "apartment" : "complex"}`,
    );
    expect(expectedResponse.ok()).toBeTruthy();
    const expectedItems = (await expectedResponse.json()).items as { slug: string }[];
    await expect(page.locator(".property-card")).toHaveCount(expectedItems.length);
    for (const item of expectedItems) {
      await expect(page.locator(`.property-card[href="/catalog/${item.slug}"]`)).toBeVisible();
    }

    await page.getByRole("button", { name: "Фильтры", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Тип недвижимости", { exact: false })).toHaveCount(elite ? 0 : 1);
    await dialog.getByRole("spinbutton", { name: "Цена от", exact: true }).fill("1");
    const applyResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/properties" &&
      new URL(response.url()).searchParams.get("minPrice") === "1",
    );
    await dialog.getByRole("button", { name: "Показать объекты", exact: true }).click();
    const applied = await applyResponse;
    expect(applied.ok()).toBeTruthy();
    expect(new URL(applied.url()).searchParams.get("elite")).toBe(String(elite));
    expect(new URL(applied.url()).searchParams.get("type")).toBe(elite ? "apartment" : "complex");
    await expect(page.locator(".property-card")).toHaveCount((await applied.json()).items.length);

    await page.getByRole("button", { name: "Фильтры", exact: true }).click();
    const resetResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/properties" &&
      !new URL(response.url()).searchParams.has("minPrice"),
    );
    await dialog.getByRole("button", { name: "Сбросить фильтры", exact: true }).click();
    const reset = await resetResponse;
    expect(reset.ok()).toBeTruthy();
    expect(new URL(reset.url()).searchParams.get("elite")).toBe(String(elite));
    expect(new URL(reset.url()).searchParams.get("type")).toBe(elite ? "apartment" : "complex");
    await expect(page).toHaveURL(new RegExp(`${path}#homes$`));
    await expect(page.locator(".property-card")).toHaveCount((await reset.json()).items.length);
  }
});
