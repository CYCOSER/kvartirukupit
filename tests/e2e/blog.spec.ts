import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
test("articles: authenticated editor, draft, SEO, publish, unpublish and delete", async ({
  page,
  request,
}) => {
  const env = {
    ...Object.fromEntries(
      (await readFile(".env", "utf8"))
        .split(/\r?\n/)
        .filter((l) => l.includes("="))
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
    ),
    ...process.env,
  };
  expect((await request.get("/api/admin/articles")).status()).toBe(401);
  const slug = "qa-article-" + Date.now();
  const title = "Проверочная статья " + Date.now();
  const imageAlt = "Балтийские дюны рядом с Калининградом";
  const seoKeywords =
    "новостройки Калининграда, покупка квартиры, Балтийское море";
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
    await page.getByLabel("SEO-название фото", { exact: true }).fill(imageAlt);
    await page.getByText("SEO-настройки", { exact: true }).click();
    await page.getByLabel("SEO-заголовок").fill("Проверочный SEO заголовок");
    await page
      .getByLabel("Ключевые слова страницы", { exact: true })
      .fill(seoKeywords);
    const seoDescription = page.getByLabel("SEO-описание", { exact: true });
    const initialHeight = (await seoDescription.boundingBox())!.height;
    await seoDescription.fill(Array(12).fill("Описание статьи").join("\n"));
    await expect
      .poll(async () => (await seoDescription.boundingBox())!.height)
      .toBeGreaterThan(initialHeight);
    await seoDescription.fill("Проверочное описание статьи.");
    await expect
      .poll(async () => (await seoDescription.boundingBox())!.height)
      .toBeLessThanOrEqual(initialHeight);
    await page.getByRole("button", { name: "Предпросмотр" }).click();
    await expect(page.locator(".article-preview h2").last()).toHaveText(
      "Выбор квартиры",
    );
    await expect(page.locator(".article-preview > img")).toBeVisible();
    await expect(page.locator(".article-preview > img")).toHaveAttribute(
      "alt",
      imageAlt,
    );
    await page.getByRole("button", { name: "Сохранить статью" }).click();
    await expect(page.getByRole("status")).toHaveText("Статья сохранена.");
    const items = await (await page.request.get("/api/admin/articles")).json();
    const created = items.find((a: any) => a.slug === slug);
    id = created.id;
    expect(created.image).toMatch(/^\/uploads\/.+\.webp$/);
    expect(created).toMatchObject({ imageAlt, seoKeywords });
    expect((await request.get("/api/articles/" + slug)).status()).toBe(404);
    expect(await (await request.get("/sitemap.xml")).text()).not.toContain(
      "/blog/" + slug,
    );
    await page
      .getByRole("row")
      .filter({ hasText: title })
      .getByRole("button", { name: "Редактировать" })
      .click();
    await expect(
      page.getByLabel("SEO-название фото", { exact: true }),
    ).toHaveValue(imageAlt);
    await page.getByText("SEO-настройки", { exact: true }).click();
    await expect(
      page.getByLabel("Ключевые слова страницы", { exact: true }),
    ).toHaveValue(seoKeywords);
    await page.getByLabel("Опубликовать статью").check();
    await page.getByRole("button", { name: "Сохранить статью" }).click();
    await expect(page.getByRole("status")).toHaveText("Статья сохранена.");
    await page.goto("/blog/" + slug);
    await expect(page).toHaveTitle(/Проверочный SEO заголовок/);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      "Проверочное описание статьи.",
    );
    await expect(page.locator('meta[name="keywords"]')).toHaveAttribute(
      "content",
      seoKeywords,
    );
    await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute(
      "content",
      imageAlt,
    );
    const rendered = await (await request.get("/blog/" + slug)).text();
    expect(rendered).toContain('name="keywords"');
    expect(rendered).toContain(seoKeywords);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    const feedback = page.locator(".article-feedback");
    const usefulButton = feedback.getByRole("button", {
      name: "Отметить статью как полезную",
    });
    await expect(usefulButton).toBeEnabled();
    const visitorSession = (await page.context().cookies()).find(
      (cookie) => cookie.name === "article_session",
    );
    expect(visitorSession).toBeDefined();
    expect(visitorSession!.expires - Date.now() / 1000).toBeGreaterThan(
      23 * 60 * 60,
    );
    expect(visitorSession!.expires - Date.now() / 1000).toBeLessThanOrEqual(
      24 * 60 * 60,
    );
    await usefulButton.click();
    await expect(feedback.getByRole("status")).toHaveText("Спасибо за отзыв!");
    await expect(usefulButton).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    const persistedUsefulButton = page
      .locator(".article-feedback")
      .getByRole("button", { name: "Отметить статью как полезную" });
    await expect(persistedUsefulButton).toHaveAttribute("aria-pressed", "true");
    await expect(persistedUsefulButton).toBeDisabled();
    const listedArticle = (await (
      await request.get("/api/articles")
    ).json()).find((item: { slug: string }) => item.slug === slug);
    expect(listedArticle).toMatchObject({
      viewCount: 1,
      usefulCount: 1,
    });
    await expect(page.locator(".article-page .scene-photo")).toBeVisible();
    await expect(page.locator(".article-page .scene-photo")).toHaveAttribute(
      "alt",
      imageAlt,
    );
    const photo = page.locator(".article-photo");
    await expect(photo).toBeVisible();
    await expect(photo).toHaveAttribute("alt", imageAlt);
    await expect(photo).toHaveAttribute("title", imageAlt);
    await expect
      .poll(() =>
        photo.evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBeGreaterThan(0);
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
        if (path === "/blog") {
          await expect(
            page.locator(`a[href="/blog/${slug}"] img`),
          ).toHaveAttribute("alt", imageAlt);
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBeTruthy();
      }
    }
    await page.goto("/blog");
    const articleCard = page.locator(".blog-card").filter({ hasText: title });
    await expect(
      articleCard.locator('[aria-label="Просмотров: 1"]'),
    ).toBeVisible();
    await expect(
      articleCard.locator('[aria-label="Оценок «полезно»: 1"]'),
    ).toBeVisible();
    await page.goto("/admin-console-9Xk6uiIs/articles");
    await page
      .getByRole("row")
      .filter({ hasText: title })
      .getByRole("button", { name: "Редактировать" })
      .click();
    await page.getByRole("button", { name: "Удалить обложку" }).click();
    await page.getByLabel("SEO-название фото", { exact: true }).fill("");
    await page.getByText("SEO-настройки", { exact: true }).click();
    await page.getByLabel("Ключевые слова страницы", { exact: true }).fill("");
    await page.getByRole("button", { name: "Сохранить статью" }).click();
    await expect(page.getByRole("status")).toHaveText("Статья сохранена.");
    await page.goto("/blog/" + slug);
    await expect(page.locator(".article-photo")).toHaveCount(0);
    await expect(page.locator('meta[name="keywords"]')).toHaveCount(0);
    await expect(page.locator(".scene-photo")).toHaveAttribute(
      "src",
      "/images/backgrounds/article-fallback.webp",
    );
    await page.goto("/admin-console-9Xk6uiIs/articles");
    await page
      .getByRole("row")
      .filter({ hasText: title })
      .getByRole("button", { name: "Редактировать" })
      .click();
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
        headers: { Origin: new URL(page.url()).origin },
      });
  }
});
