import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
test("articles: authenticated editor, draft, SEO, publish, unpublish and delete", async ({
  page,
  request,
}) => {
  const env = Object.fromEntries(
    (await readFile(".env", "utf8"))
      .split(/\r?\n/)
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
  expect((await request.get("/api/admin/articles")).status()).toBe(401);
  const slug = "qa-article-" + Date.now();
  const title = "Проверочная статья " + Date.now();
  let id = "";
  await page.goto("/admin-console-9Xk6uiIs/login");
  await page.getByLabel("Email", { exact: true }).fill(env.ADMIN_EMAIL!);
  await page.getByLabel("Пароль", { exact: true }).fill(env.ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/admin-console-9Xk6uiIs\/properties/);
  await page.goto("/admin-console-9Xk6uiIs/articles");
  try {
    await page.getByRole("button", { name: "Новая статья" }).click();
    await page.getByLabel("Заголовок статьи", { exact: true }).fill(title);
    await page.getByLabel("Адрес статьи").fill(slug);
    await page
      .getByLabel("Краткий анонс")
      .fill("Проверочный анонс статьи о выборе квартиры в Калининграде.");
    await page
      .getByLabel("Текст статьи")
      .fill(
        "## Выбор квартиры\n\nПроверочный текст о выборе квартиры, его характеристиках и расположении.\n\n- Площадь\n- Участок",
      );
    await page
      .getByLabel("Обложка статьи")
      .setInputFiles("public/images/journal-dunes.webp");
    await page.getByText("SEO-настройки", { exact: true }).click();
    await page.getByLabel("SEO-заголовок").fill("Проверочный SEO заголовок");
    const seoDescription = page.getByLabel("SEO-описание", { exact: true });
    const initialHeight = (await seoDescription.boundingBox())!.height;
    await seoDescription.fill(Array(12).fill("Описание статьи").join("\n"));
    await expect.poll(async () => (await seoDescription.boundingBox())!.height).toBeGreaterThan(initialHeight);
    await seoDescription.fill("Проверочное описание статьи.");
    await expect.poll(async () => (await seoDescription.boundingBox())!.height).toBeLessThanOrEqual(initialHeight);
    await page.getByRole("button", { name: "Предпросмотр" }).click();
    await expect(page.locator(".article-preview h2").last()).toHaveText(
      "Выбор квартиры",
    );
    await expect(page.locator(".article-preview > img")).toBeVisible();
    await page.getByRole("button", { name: "Сохранить статью" }).click();
    await expect(page.getByRole("status")).toHaveText("Статья сохранена.");
    const items = await (await page.request.get("/api/admin/articles")).json();
    const created = items.find((a: any) => a.slug === slug);
    id = created.id;
    expect(created.image).toMatch(/^\/uploads\/.+\.webp$/);
    expect((await request.get("/api/articles/" + slug)).status()).toBe(404);
    expect(await (await request.get("/sitemap.xml")).text()).not.toContain(
      "/blog/" + slug,
    );
    await page
      .getByRole("row")
      .filter({ hasText: title })
      .getByRole("button", { name: "Редактировать" })
      .click();
    await page.getByLabel("Опубликовать статью").check();
    await page.getByRole("button", { name: "Сохранить статью" }).click();
    await expect(page.getByRole("status")).toHaveText("Статья сохранена.");
    await page.goto("/blog/" + slug);
    await expect(page).toHaveTitle(/Проверочный SEO заголовок/);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", "Проверочное описание статьи.");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(page.locator(".article-page .scene-photo")).toBeVisible();
    await expect(page.locator(".article-body li")).toHaveCount(2);
    expect(
      await page.locator('script[type="application/ld+json"]').textContent(),
    ).toContain("BlogPosting");
    expect(await (await request.get("/sitemap.xml")).text()).toContain(
      "/blog/" + slug,
    );
    for (const width of [360, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const path of ["/blog", "/blog/" + slug]) {
        await page.goto(path);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBeTruthy();
      }
    }
    await page.goto("/admin-console-9Xk6uiIs/articles");
    await page
      .getByRole("row")
      .filter({ hasText: title })
      .getByRole("button", { name: "Редактировать" })
      .click();
    await page.getByRole("button", { name: "Удалить обложку" }).click();
    await page.getByLabel("Опубликовать статью").uncheck();
    await page.getByRole("button", { name: "Сохранить статью" }).click();
    await expect(page.getByRole("status")).toHaveText("Статья сохранена.");
    expect((await request.get("/api/articles/" + slug)).status()).toBe(404);
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("row")
      .filter({ hasText: title })
      .getByRole("button", { name: "Удалить" })
      .click();
    await expect(page.getByRole("status")).toHaveText("Статья удалена.");
    expect((await request.get("/blog/" + slug)).status()).toBe(404);
  } finally {
    if (id)
      await page.request.delete("/api/admin/articles/" + id, {
        headers: { Origin: "http://localhost:3100" },
      });
  }
});
