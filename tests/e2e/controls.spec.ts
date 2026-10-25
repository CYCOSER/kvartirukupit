import { test, expect } from "@playwright/test";

test("dropdowns flip upward and work in mobile filters", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.goto("/catalog");
  await page.getByRole("button", { name: "Фильтры", exact: true }).click();
  const filters = page.getByRole("dialog");
  const type = filters.getByRole("combobox").first();
  await expect(type).toContainText("Жилой комплекс");
  await type.click();
  await expect(page.locator(".select-panel")).toHaveAttribute(
    "data-side",
    "bottom",
  );
  await expect(
    page.getByRole("option", { name: "Жилой комплекс", exact: true }),
  ).toBeVisible();
  await page
    .locator(".select-panel")
    .evaluate((el) =>
      Promise.all(el.getAnimations().map((animation) => animation.finished)),
    );
  await page.screenshot({ path: testInfo.outputPath("select-down.png") });
  await page.keyboard.press("Escape");
  await expect(type).toBeFocused();
  await type.press("ArrowDown");
  await expect(
    page.getByRole("option", { name: "Жилой комплекс", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("End");
  await expect(
    page.getByRole("option", { name: "Квартира", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(type).toContainText("Квартира");
  await page.setViewportSize({ width: 1100, height: 250 });
  await type.scrollIntoViewIfNeeded();
  await type.click();
  await expect(page.locator(".select-panel")).toHaveAttribute(
    "data-side",
    "top",
  );
  await page
    .locator(".select-panel")
    .evaluate((el) =>
      Promise.all(el.getAnimations().map((animation) => animation.finished)),
    );
  await page.screenshot({ path: testInfo.outputPath("select-up.png") });
  await page.getByRole("option", { name: "Квартира", exact: true }).click();
  await expect(type).toContainText("Квартира");
  await filters.getByRole("button", { name: "Показать объекты" }).click();
  await expect(page).toHaveURL(/type=apartment/);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/catalog");
  await page.getByRole("button", { name: "Фильтры", exact: true }).click();
  const mobile = page.getByRole("dialog");
  await mobile.getByRole("combobox").first().click();
  await page
    .getByRole("option", { name: "Жилой комплекс", exact: true })
    .click();
  await mobile.getByRole("button", { name: "Показать объекты" }).click();
  await expect(page).toHaveURL(/type=complex/);
});

test("price changes by 300000 and floor area by 10 without restricting manual values", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto("/catalog");
  await page.getByRole("button", { name: "Фильтры", exact: true }).click();
  const form = page.getByRole("dialog");
  await form
    .getByRole("button", { name: "Увеличить цену от", exact: true })
    .click();
  await expect(form.getByLabel("Цена от")).toHaveValue("300000");
  await form.getByLabel("Цена от").fill("14500000");
  await form.getByLabel("Цена от").press("ArrowUp");
  await expect(form.getByLabel("Цена от")).toHaveValue("14800000");
  await form
    .getByRole("button", { name: "Уменьшить цену от", exact: true })
    .click();
  await expect(form.getByLabel("Цена от")).toHaveValue("14500000");
  await form.getByLabel("Площадь от", { exact: true }).fill("112.5");
  await form
    .getByRole("button", { name: "Увеличить площадь от", exact: true })
    .click();
  await expect(form.getByLabel("Площадь от", { exact: true })).toHaveValue(
    "122.5",
  );
  await form.getByRole("button", { name: "Показать объекты" }).click();
  await expect(page).toHaveURL(/minPrice=14500000/);
  await expect(page).toHaveURL(/minArea=122.5/);
});
