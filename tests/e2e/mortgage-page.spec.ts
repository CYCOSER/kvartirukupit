import { test, expect } from "@playwright/test";

test("mortgage page is rendered for search engines and linked from navigation", async ({ page, request }) => {
  const response = await request.get("/ipoteka");
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain("Ипотека на новостройки");
  expect(html).toContain("Семейная ипотека");
  expect(html).toContain("BreadcrumbList");
  expect((await (await request.get("/sitemap.xml")).text())).toContain("/ipoteka</loc>");
  await page.goto("/");
  await page.getByRole("navigation", { name: "Основная навигация", exact: true }).getByRole("link", { name: "Ипотека", exact: true }).click();
  await expect(page).toHaveURL(/\/ipoteka$/);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page).toHaveTitle(/Ипотека на новостройки в Калининграде/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/ipoteka$/);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /первоначальный взнос/);
});

test("mortgage page calculator, questions and enquiry work on desktop and mobile", async ({ page }) => {
  await page.goto("/ipoteka");
  await page.getByRole("link", { name: "Рассчитать платёж ↓" }).click();
  const calculator = page.locator("#mortgage");
  await expect(calculator.locator(".mortgage-payment")).toHaveText("0 ₽");
  await expect(calculator.locator("dd")).toHaveText(["0 ₽", "0 ₽", "0 ₽", "0 ₽"]);
  await calculator.getByLabel("Стоимость квартиры, ₽", { exact: true }).fill("1200000");
  await calculator.getByLabel("Первоначальный взнос, %", { exact: true }).fill("0");
  await calculator.getByLabel("Срок, лет", { exact: true }).fill("10");
  await calculator.getByLabel("Ставка, % годовых", { exact: true }).fill("0");
  await expect(calculator.locator(".mortgage-payment")).toHaveText("10 000 ₽");
  const question = page.locator("details").first();
  await question.locator("summary").click();
  await expect(question.locator("p")).toBeVisible();
  for (const width of [360, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.screenshot({ path: `test-results/ipoteka-${width}.png`, fullPage: true });
  }
  let enquiry: Record<string, unknown> | undefined;
  await page.route("**/api/leads", async (route) => {
    enquiry = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true } });
  });
  const form = page.locator(".lead-form");
  await form.getByLabel("Номер телефона").fill("+79991234567");
  await form.getByLabel(/Комментарий/).fill("Интересует квартира в ипотеку");
  await form.getByRole("checkbox").check();
  await form.getByRole("button", { name: "Обсудить подбор" }).click();
  await expect(page.getByRole("status")).toContainText("Заявка принята");
  expect(enquiry?.comment).toBe("Интересует квартира в ипотеку");
});

test("mortgage programmes link to published articles with official sources", async ({ page, request }) => {
  await page.goto("/ipoteka");
  const links = page.locator(".program-source");
  await expect(links).toHaveCount(3);
  const sitemap = await (await request.get("/sitemap.xml")).text();
  for (const link of await links.all()) {
    const href = await link.getAttribute("href");
    expect(href).toMatch(/^\/blog\//);
    const response = await request.get(href!);
    expect(response.status()).toBe(200);
    expect(sitemap).toContain(href + "</loc>");
  }
  await links.first().click();
  await expect(page.locator("h1")).toContainText("Семейная ипотека");
  await expect(page.locator(".article-body a[href^='https://']").first()).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/blog\/semeynaya-ipoteka-kaliningrad$/);
});

test("partner logos show names on hover and keyboard focus", async ({ page }) => {
  await page.goto("/ipoteka");
  const partners = page.locator(".purchase-banks");
  await expect(partners.getByRole("heading", { name: "Партнёры" })).toBeVisible();
  await expect(partners.getByRole("button")).toHaveCount(10);
  await expect(partners.locator("ul")).toHaveText("");
  await expect(page.locator(".bank-tooltip")).toHaveCount(0);
  await partners.scrollIntoViewIfNeeded();
  await expect.poll(() => page.locator(".mortgage-unfold").evaluate(element =>
    Math.abs(element.clientHeight - (element.firstElementChild as HTMLElement).offsetHeight),
  )).toBeLessThan(1);

  await partners.getByRole("button", { name: "Сбер", exact: true }).hover();
  await expect(page.locator(".bank-tooltip")).toBeVisible();
  await expect(partners.getByRole("button", { name: "Сбер", exact: true })).toHaveAccessibleDescription("Сбер");
  await expect(page.locator(".bank-tooltip")).toHaveAttribute("data-side", "top");
  await page.keyboard.press("Escape");
  await expect(page.locator(".bank-tooltip")).toHaveCount(0);

  await page.mouse.move(0, 0);
  await partners.getByRole("button", { name: "ВТБ", exact: true }).focus();
  await expect(page.locator(".bank-tooltip")).toBeVisible();
  await expect(partners.getByRole("button", { name: "ВТБ", exact: true })).toHaveAccessibleDescription("ВТБ");
  await page.keyboard.press("Tab");
  await expect(partners.getByRole("button", { name: "Альфа-Банк", exact: true })).toBeFocused();
  await expect(partners.getByRole("button", { name: "Альфа-Банк", exact: true })).toHaveAccessibleDescription("Альфа-Банк");
  await page.keyboard.press("Escape");
  await expect(page.locator(".bank-tooltip")).toHaveCount(0);
  for (const name of ["Райффайзенбанк", "Т-Банк"]) {
    await partners.getByRole("button", { name, exact: true }).focus();
    await expect(page.locator(".bank-tooltip")).toHaveAttribute("data-side", "bottom");
    await expect(partners.getByRole("button", { name, exact: true })).toHaveAccessibleDescription(name);
    await page.keyboard.press("Escape");
  }
});
