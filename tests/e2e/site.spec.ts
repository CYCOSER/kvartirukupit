import { test, expect, type APIRequestContext } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import type { Property } from "../../shared/property";

const env = { ...parseEnv(await readFile(".env", "utf8")), ...process.env };
const origin = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3100";
const admin = "/morskoy-kabinet-7q4x";
const headers = { Origin: origin };
const credentials = { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD };

async function cleanTestProperty(request: APIRequestContext, id: string) {
  const response = await request.get("/api/admin/properties/" + id);
  if (response.status() === 404) return;
  expect(response.ok()).toBe(true);
  const item = await response.json();
  if (!item) return;
  expect(item.sourceId).toBeNull();
  expect(item.slug).toMatch(/^e2e-/);
  expect(
    (await request.delete("/api/admin/properties/" + id, { headers })).ok(),
  ).toBe(true);
  // Uploaded files are retained by the application's recovery policy.
}

test("responsive site, source cards, filters and keyboard menu", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  const catalog = await (
    await page.request.get("/api/properties?type=complex")
  ).json();
  const property: Property = catalog.items.find(
    (item: Property) => item.sourceId,
  );
  expect(property).toBeTruthy();
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Жить красиво",
    );
    await expect(page.locator(".hero-primary")).toHaveAttribute(
      "href",
      "/catalog",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.goto("/catalog/" + property.slug);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      property.title,
    );
    await expect(page.getByLabel("Номер телефона")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.goto("/catalog");
    await expect(page.locator(".property-card").first()).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "Фильтры", exact: true }).click();
  const filters = page.getByRole("dialog");
  await expect(filters).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(filters).toHaveCount(0);
  await page.goto("/catalog?type=complex");
  await expect(page.locator(".property-card")).toHaveCount(
    catalog.items.length,
  );
  await page.reload();
  await expect(page.locator(".property-card")).toHaveCount(
    catalog.items.length,
  );
  await page.goto("/catalog?minPrice=2000000001");
  await expect(page.getByText("Пока нет подходящих новостроек")).toBeVisible();
  await page.goto("/catalog/nonexistent-property");
  await expect(page.getByText("Страница не найдена")).toBeVisible();
  expect((await page.request.get("/sell")).status()).toBe(404);
  expect(errors).toEqual([]);
});

test("lead form sends explicit buyer consent and shows confirmation without test leads", async ({
  page,
}) => {
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/leads", async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true } });
  });
  const catalog = await (await page.request.get('/api/properties')).json();
  expect(catalog.items.length).toBeGreaterThan(0);
  await page.goto('/catalog/' + catalog.items[0].slug);
  await expect(page.getByLabel("Ваше имя необязательно")).toHaveJSProperty("required", false);
  await page.getByLabel("Номер телефона").fill("+7 999 123-45-67");
  await page
    .getByLabel(/Комментарий/)
    .fill("Проверка интерфейса без записи заявки");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Обсудить подбор", exact: true }).click();
  await expect(page.getByText("Заявка принята")).toBeVisible();
  expect(submitted).toMatchObject({
    name: "",
    consent: true,
    purpose: "buyer",
  });
  expect(submitted?.propertyId).toBeTruthy();
});

test("home and property enquiry forms share their appearance on desktop and mobile", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const catalog = await (await page.request.get('/api/properties')).json();
  expect(catalog.items.length).toBeGreaterThan(0);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const appearances = [];
    for (const path of ["/", '/catalog/' + catalog.items[0].slug]) {
      await page.goto(path);
      const form = page.locator(".lead-form");
      await form.scrollIntoViewIfNeeded();
      await expect(form.getByRole("heading", { name: "Квартира для вашей жизни" })).toBeVisible();
      await expect(form.getByRole("button", { name: "Обсудить подбор", exact: true })).toBeVisible();
      appearances.push(await form.evaluate((element) => {
        const selectors = [":scope", ".lead-form-icon", ".lead-form-kicker", "h3", "label", "input:not([type=checkbox])", "textarea", ".consent", "button", ".lead-form-note"];
        return selectors.map((selector) => {
          const style = getComputedStyle(selector === ":scope" ? element : element.querySelector(selector)!);
          return [style.backgroundColor, style.color, style.borderRadius, style.padding, style.fontSize, style.fontFamily];
        });
      }));
    }
    expect(appearances[1]).toEqual(appearances[0]);
  }
});

test("authorization, temporary property CRUD, gallery and validation", async ({
  request,
}) => {
  expect((await request.get("/api/admin/properties")).status()).toBe(401);
  expect(
    (
      await request.post("/api/admin/login", {
        data: credentials,
        headers: { Origin: "https://evil.example" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/api/admin/login", { data: credentials, headers })
    ).ok(),
  ).toBe(true);
  const p = {
    title: "Проверочная квартира",
    slug: "e2e-apartment-" + Date.now(),
    type: "apartment",
    location: "Калининград",
    address: "Тестовый адрес",
    price: 10000000,
    status: "available",
    area: 42,
    landArea: null,
    bedrooms: 1,
    floors: 5,
    readiness: "Готов",
    finish: "Чистовая",
    seaDistance: null,
    description: "Временная карточка проверки, удаляется после теста.",
    utilities: [],
    published: false,
    featured: false,
    demo: true,
  };
  const created = await request.post("/api/admin/properties", {
    data: p,
    headers,
  });
  expect(created.ok()).toBe(true);
  const item = await created.json();
  try {
    expect((await request.get("/api/properties/" + p.slug)).status()).toBe(404);
    const updated = await request.put("/api/admin/properties/" + item.id, {
      data: { ...p, published: true, sourceUrl: "https://fake.example" },
      headers,
    });
    expect(updated.ok()).toBe(true);
    expect((await updated.json()).sourceUrl).toBeNull();
    expect((await request.get("/api/properties/" + p.slug)).ok()).toBe(true);
    const image = await request.post(
      "/api/admin/properties/" + item.id + "/images",
      {
        headers,
        multipart: {
          file: {
            name: "test.webp",
            mimeType: "image/webp",
            buffer: await readFile("public/images/baltic-hero.webp"),
          },
          alt: "Тестовая фотография",
        },
      },
    );
    expect(image.ok()).toBe(true);
    const img = await image.json();
    expect((await request.get(img.file)).ok()).toBe(true);
    expect(
      (
        await request.put("/api/admin/properties/" + item.id + "/images", {
          headers,
          data: [{ id: img.id, alt: "Обновлённая подпись" }],
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await request.post("/api/admin/properties/" + item.id + "/images", {
          headers,
          multipart: {
            file: {
              name: "bad.svg",
              mimeType: "image/svg+xml",
              buffer: Buffer.from("<svg/>"),
            },
          },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await request.put("/api/admin/properties/" + item.id, {
          data: { ...p, price: -1 },
          headers,
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await request.put("/api/admin/properties/" + item.id, {
          data: { ...p, published: true, status: "sold" },
          headers,
        })
      ).ok(),
    ).toBe(true);
    const list = await (await request.get("/api/properties")).json();
    expect(list.items.some((value: Property) => value.id === item.id)).toBe(
      false,
    );
    expect(
      (
        await request.post("/api/leads", {
          data: {
            name: "Тест",
            phone: "+79991234567",
            consent: true,
            propertyId: item.id,
          },
          headers,
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await request.post("/api/leads", {
          data: { name: "Тест", phone: "+79991234567", consent: false },
          headers,
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await request.post("/api/leads", {
          data: {
            name: "Тест",
            phone: "+79991234567",
            consent: true,
            website: "spam",
          },
          headers,
        })
      ).ok(),
    ).toBe(true);
  } finally {
    await cleanTestProperty(request, item.id);
    await request.post("/api/admin/logout", { headers });
  }
  expect((await request.get("/api/properties/" + p.slug)).status()).toBe(404);
  expect((await request.get("/api/admin/me")).status()).toBe(401);
  expect((await request.get("/sitemap.xml")).ok()).toBe(true);
  expect(await (await request.get("/robots.txt")).text()).not.toContain(
    "morskoy-kabinet-7q4x",
  );
  expect((await request.get("/admin")).status()).toBe(404);
});

test("manager creates, previews and removes a temporary object", async ({
  page,
}) => {
  await page.goto(admin + "/login");
  await page.getByLabel("Email", { exact: true }).fill(env.ADMIN_EMAIL!);
  await page.getByLabel("Пароль", { exact: true }).fill(env.ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/morskoy-kabinet-7q4x\/properties/);
  await page.getByRole("link", { name: "Добавить объект" }).click();
  const slug = "e2e-interface-" + Date.now();
  await page
    .getByLabel("Название", { exact: true })
    .fill("Проверка интерфейса");
  await page.getByLabel("Адрес страницы", { exact: true }).fill(slug);
  await page
    .getByLabel("Описание", { exact: true })
    .fill("Временная проверка административной формы.");
  const creating = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/admin/properties") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Сохранить объект" }).click();
  const response = await creating;
  expect(response.ok()).toBe(true);
  const { id } = await response.json();
  try {
    await expect(page).toHaveURL(
      /morskoy-kabinet-7q4x\/properties\/[a-z0-9]+$/,
    );
    await page
      .getByLabel(/Добавить фото/)
      .setInputFiles([
        "public/images/baltic-hero.webp",
        "public/images/baltic-terrace.webp",
      ]);
    await expect(page.getByText("Фотографии загружены.")).toBeVisible();
    await expect(page.locator(".admin-gallery img")).toHaveCount(2);
    await page
      .getByRole("button", { name: "Переместить фото позже" })
      .first()
      .click();
    await page.getByLabel("Описание фото 1").fill("Обложка после перестановки");
    await page.getByLabel("Опубликован", { exact: true }).check();
    await page.getByLabel("Цена, ₽ (пусто — по запросу)").fill("14500000");
    await page.getByRole("button", { name: "Сохранить объект" }).click();
    await expect(page.getByText("Объект сохранён.")).toBeVisible();
    await page.goto("/catalog/" + slug);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Проверка интерфейса",
    );
    await expect(page.locator(".gallery-thumbs button")).toHaveCount(2);
    await expect(page.locator(".gallery-main img").first()).toHaveAttribute(
      "alt",
      "Обложка после перестановки",
    );
    await page.goto(admin + "/properties");
    await page
      .getByRole("row")
      .filter({ hasText: "Проверка интерфейса" })
      .getByRole("button", { name: "Удалить" })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Удалить", exact: true })
      .click();
    await expect(
      page.getByRole("row").filter({ hasText: "Проверка интерфейса" }),
    ).toHaveCount(0);
  } finally {
    await cleanTestProperty(page.request, id);
    await page.request.post("/api/admin/logout", { headers });
  }
});

test("catalog validates filters, applies matching types and sorts unknown values last", async ({
  request,
}) => {
  for (const type of ["complex", "apartment"]) {
    const response = await request.get(
      "/api/properties?status=all&type=" + type,
    );
    expect(response.ok()).toBe(true);
    const { items } = await response.json();
    expect(items.every((property: Property) => property.type === type)).toBe(
      true,
    );
  }
  const filtered = await (
    await request.get("/api/properties", {
      params: {
        location: "Калининград",
        minPrice: "1",
        minArea: "1",
        bedrooms: "1",
      },
    })
  ).json();
  expect(
    filtered.items.every(
      (p: Property) =>
        p.location === "Калининград" &&
        p.price! >= 1 &&
        p.area! >= 1 &&
        p.bedrooms! >= 1,
    ),
  ).toBe(true);
  for (const field of ["price", "area"] as const) {
    for (const direction of ["asc", "desc"]) {
      const { items } = (await (
        await request.get(
          "/api/properties?status=all&sort=" + field + "_" + direction,
        )
      ).json()) as { items: Property[] };
      const numbers = items
        .map((p) => p[field])
        .filter((n): n is number => n !== null);
      expect(numbers).toEqual(
        [...numbers].sort((a, b) => (direction === "asc" ? a - b : b - a)),
      );
      const firstUnknown = items.findIndex((p) => p[field] === null);
      if (firstUnknown >= 0)
        expect(items.slice(firstUnknown).every((p) => p[field] === null)).toBe(
          true,
        );
    }
  }
  expect((await request.get("/api/properties?type=house")).status()).toBe(400);
});
