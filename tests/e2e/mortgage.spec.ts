import { test, expect } from "@playwright/test";
test("mortgage responds to fields, presets and invalid values", async ({
  page,
}) => {
  await page.goto("/catalog/zhk-traditsiya");
  const calc = page.locator("#mortgage");
  await expect(calc).toBeVisible();
  const cost = calc.getByLabel("Стоимость квартиры, ₽", { exact: true });
  const deposit = calc.getByLabel("Первоначальный взнос, %", { exact: true });
  const years = calc.getByLabel("Срок, лет", { exact: true });
  const rate = calc.getByLabel("Ставка, % годовых", { exact: true });
  await expect(deposit).toHaveValue("20");
  await expect(years).toHaveValue("20");
  await expect(rate).toHaveValue("16.9");
  await cost.fill("1200000");
  await deposit.fill("0");
  await years.fill("10");
  await rate.fill("0");
  await expect(calc.locator(".mortgage-payment")).toHaveText("10 000 ₽");
  await calc.getByRole("button", { name: "50%", exact: true }).click();
  await expect(calc.locator(".mortgage-payment")).toHaveText("5 000 ₽");
  await expect(calc.getByRole("slider")).toHaveCount(0);
  await expect(calc.locator("details")).toHaveCount(0);
  await deposit.fill("100");
  await expect(
    calc.getByText("При взносе 100% кредит не требуется."),
  ).toBeVisible();
  await years.fill("0");
  await expect(calc.locator(".mortgage-payment")).toHaveCount(0);
  await years.fill("20");
  await deposit.fill("20");
  await rate.fill("16.9");
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await calc.screenshot({ path: `test-results/mortgage-${width}.png` });
  }
  await page.setViewportSize({ width: 360, height: 1000 });
  await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
