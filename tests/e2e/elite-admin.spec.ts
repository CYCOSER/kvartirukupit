import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";

const env = { ...parseEnv(await readFile(".env", "utf8")), ...process.env };
const headers = {
  Origin: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3100",
};

test("admin editor saves a manually added elite apartment", async ({ page }) => {
  const login = await page.request.post("/api/admin/login", {
    headers,
    data: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
  });
  expect(login.ok()).toBe(true);
  await page.goto("/admin-console-9Xk6uiIs/properties/new");
  const type = page.getByRole("combobox", { name: "Тип объекта", exact: true });
  await type.click();
  await page.getByRole("option", { name: "Элитная квартира", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Жилой комплекс квартиры", exact: true })).toBeVisible();
  await type.click();
  await page.getByRole("option", { name: "Жилой комплекс", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Жилой комплекс квартиры", exact: true })).toHaveCount(0);
  await type.click();
  await page.getByRole("option", { name: "Квартира", exact: true }).click();
  await expect(type).toHaveText("Квартира");
  await type.click();
  await page.getByRole("option", { name: "Элитная квартира", exact: true }).click();
  await page.getByLabel("Название", { exact: true }).fill("Проверка элитной квартиры");
  await page.getByLabel("Адрес страницы", { exact: true }).fill("e2e-elite-editor-" + Date.now());
  const saving = page.waitForResponse((response) =>
    response.url().endsWith("/api/admin/properties") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Сохранить объект", exact: true }).click();
  const response = await saving;
  expect(response.ok()).toBe(true);
  const item = await response.json();
  const url = "/api/admin/properties/" + item.id;
  try {
    expect(item).toMatchObject({ elite: true, type: "apartment", published: false, sourceId: null });
    await expect(page).toHaveURL(new RegExp("/properties/" + item.id + "$"));
    await expect(type).toHaveText("Элитная квартира");
    await page.reload();
    await expect(type).toHaveText("Элитная квартира");
    const persisted = await (await page.request.get(url)).json();
    expect(persisted).toMatchObject({ elite: true, type: "apartment", published: false });
  } finally {
    expect((await page.request.delete(url, { headers })).ok()).toBe(true);
  }
});

test("manual elite apartment stays in its own catalog through publication and edits", async ({ request }) => {
  const login = await request.post("/api/admin/login", {
    headers,
    data: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
  });
  expect(login.ok()).toBe(true);
  const property = {
    title: "Проверочная элитная квартира",
    slug: "e2e-elite-" + Date.now(),
    type: "apartment",
    location: "Проверка элитного каталога",
    address: "Тестовый адрес",
    price: 25000000,
    status: "available",
    area: 120,
    landArea: null,
    bedrooms: 3,
    floors: 5,
    readiness: "Готова",
    finish: "Чистовая",
    seaDistance: null,
    description: "Временная карточка проверки, удаляется после теста.",
    utilities: [],
    published: false,
    featured: true,
    elite: true,
    demo: true,
  };
  expect((await request.post("/api/admin/properties", {
    headers,
    data: { ...property, type: "complex" },
  })).status()).toBe(400);
  const created = await request.post("/api/admin/properties", { headers, data: property });
  expect(created.ok()).toBe(true);
  const item = await created.json();
  const url = "/api/admin/properties/" + item.id;
  const eliteQuery = "/api/properties?elite=true&location=" + encodeURIComponent(property.location);
  try {
    expect(item.sourceId).toBeNull();
    expect((await (await request.get(eliteQuery)).json()).items).toHaveLength(0);
    expect((await request.get("/api/properties/" + property.slug)).status()).toBe(404);

    const published = { ...property, published: true };
    expect((await request.put(url, { headers, data: published })).ok()).toBe(true);
    const elite = await (await request.get(eliteQuery + "&type=complex")).json();
    expect(elite.items.map((p: { id: string }) => p.id)).toEqual([item.id]);
    expect(elite.locations).toContain(property.location);
    for (const query of ["", "?elite=false", "?featured=true"]) {
      const ordinary = await (await request.get("/api/properties" + query)).json();
      expect(ordinary.items.some((p: { id: string }) => p.id === item.id)).toBe(false);
      expect(ordinary.locations).not.toContain(property.location);
    }
    const random = await (await request.get("/api/properties/random")).json();
    expect(random.items.some((p: { id: string }) => p.id === item.id)).toBe(false);
    expect((await request.get("/api/properties?elite=invalid")).status()).toBe(400);

    expect((await request.put(url, { headers, data: { ...published, price: 27000000 } })).ok()).toBe(true);
    const edited = await (await request.get(eliteQuery)).json();
    expect(edited.items[0].price).toBe(27000000);
    expect((await request.get("/api/properties/" + property.slug)).ok()).toBe(true);
  } finally {
    expect((await request.delete(url, { headers })).ok()).toBe(true);
  }
  expect((await (await request.get(eliteQuery)).json()).items).toHaveLength(0);
});
