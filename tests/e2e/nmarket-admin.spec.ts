import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";

const env = { ...parseEnv(await readFile(".env", "utf8")), ...process.env };

test.beforeEach(async ({ page }) => {
  const login = await page.request.post("/api/admin/login", {
    headers: {
      Origin: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3100",
    },
    data: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
  });
  expect(login.ok()).toBe(true);
});

test("Nmarket import filters the received list and imports only selected new objects", async ({
  page,
}) => {
  const studio = {
    id: "n-studio",
    title: "Студия у моря",
    category: "Квартиры",
    location: "Зеленоградск",
    address: "Морская, 1",
    price: 4000000,
    area: 25,
    bedrooms: 0,
    floors: 5,
    developer: "Первый застройщик",
    supported: true,
    existingId: null as string | null,
  };
  const apartment = {
    ...studio,
    id: "n-apartment",
    title: "Просторная квартира",
    location: "Калининград",
    address: "Центральная, 2",
    price: 9000000,
    area: 70,
    bedrooms: 2,
    developer: "Второй застройщик",
  };
  const unknown = {
    ...studio,
    id: "n-unknown",
    title: "Квартира без характеристик",
    price: null,
    area: null,
    bedrooms: null,
    floors: null,
    developer: "",
  };
  const existing = {
    ...studio,
    id: "n-existing",
    title: "Добавленная квартира",
    price: 5000000,
    area: 40,
    bedrooms: 1,
    existingId: "existing-draft",
  };
  const unsupported = {
    ...studio,
    id: "n-house",
    title: "Частный дом",
    category: "Дома",
    price: 6000000,
    area: 90,
    bedrooms: 3,
    supported: false,
  };
  const listOffsets: number[] = [];
  const imported: string[] = [];
  await page.route("**/api/admin/nmarket/objects?*", async (route) => {
    listOffsets.push(
      Number(new URL(route.request().url()).searchParams.get("offset")),
    );
    await route.fulfill({
      json: {
        items: [studio, apartment, unknown, existing, unsupported].map(
          (item) => ({
            ...item,
            existingId: imported.includes(item.id)
              ? `draft-${item.id}`
              : item.existingId,
          }),
        ),
        nextOffset: null,
      },
    });
  });
  await page.route("**/api/admin/nmarket/import", async (route) => {
    const { id } = route.request().postDataJSON();
    expect(typeof id).toBe("string");
    imported.push(id);
    await route.fulfill({
      json: {
        id: `draft-${id}`,
        created: id !== apartment.id,
        warnings: [],
      },
    });
  });

  await page.goto("/morskoy-kabinet-7q4x/properties/import?source=nmarket");
  await expect(
    page.getByRole("heading", { name: /Импорт.*Нмаркет/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Обновить из Нмаркета" }),
  ).toBeEnabled();
  expect(listOffsets).toEqual([0]);
  await expect(page.getByRole("checkbox")).toHaveCount(3);
  await expect(
    page.getByRole("link", { name: "Уже добавлен — открыть" }),
  ).toHaveAttribute("href", "/morskoy-kabinet-7q4x/properties/existing-draft");

  await page.getByRole("combobox", { name: "Сортировка", exact: true }).click();
  await page
    .getByRole("option", { name: "Сначала дороже", exact: true })
    .click();
  await expect(page.locator("tbody tr").first()).toContainText(apartment.title);
  await expect(page.locator("tbody tr").last()).toContainText(unknown.title);
  await page.getByRole("combobox", { name: "Сортировка", exact: true }).click();
  await page
    .getByRole("option", { name: "Площадь по возрастанию", exact: true })
    .click();
  await expect(page.locator("tbody tr").first()).toContainText(studio.title);

  await page.getByRole("combobox", { name: "Статус импорта" }).click();
  await page
    .getByRole("option", { name: "Уже добавлены", exact: true })
    .click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr")).toContainText(existing.title);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page.getByRole("combobox", { name: "Статус импорта" }).click();
  await page
    .getByRole("option", { name: "Готовы к импорту", exact: true })
    .click();
  await expect(page.locator("tbody tr")).toHaveCount(3);
  await expect(page.getByRole("checkbox")).toHaveCount(3);
  await page.getByRole("combobox", { name: "Статус импорта" }).click();
  await page
    .getByRole("option", { name: "Недоступны для импорта", exact: true })
    .click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr")).toContainText(unsupported.title);
  await page.getByRole("button", { name: "Сбросить фильтры" }).click();
  await expect(page.getByRole("checkbox")).toHaveCount(3);

  const search = page.getByRole("textbox", { name: "Поиск объектов Нмаркета" });
  await search.fill("ЦЕНТРАЛЬНАЯ");
  await expect(page.getByRole("checkbox")).toHaveAccessibleName(
    "Выбрать Просторная квартира (ID n-apartment)",
  );
  await search.fill("");

  await page.getByLabel("Цена от", { exact: true }).fill("3000000");
  await page.getByLabel("Цена до", { exact: true }).fill("5000000");
  await page.getByLabel("Площадь от", { exact: true }).fill("20");
  await page.getByLabel("Площадь до", { exact: true }).fill("30");
  await expect(page.getByRole("checkbox")).toHaveCount(1);
  await expect(page.getByRole("checkbox")).toHaveAccessibleName(
    "Выбрать Студия у моря (ID n-studio)",
  );
  await page.getByRole("button", { name: "Выбрать все найденные" }).click();
  await expect(page.getByRole("checkbox")).toBeChecked();

  await page.getByLabel("Цена до", { exact: true }).fill("");
  await page.getByLabel("Площадь до", { exact: true }).fill("");
  await expect(page.getByRole("checkbox")).toHaveCount(2);
  await expect(
    page.getByRole("checkbox", { name: /Студия у моря/ }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: /Просторная квартира/ }),
  ).not.toBeChecked();
  await expect(page.getByText(unknown.title, { exact: true })).toHaveCount(0);
  await page.getByLabel("Площадь от", { exact: true }).fill("");
  await page.getByLabel("Цена от", { exact: true }).fill("0");
  await expect(page.getByText(unknown.title, { exact: true })).toHaveCount(0);
  await page.getByLabel("Цена от", { exact: true }).fill("");
  await page.getByLabel("Площадь от", { exact: true }).fill("0");
  await expect(page.getByText(unknown.title, { exact: true })).toHaveCount(0);
  await page.getByLabel("Площадь от", { exact: true }).fill("");
  await expect(page.getByRole("checkbox")).toHaveCount(3);
  await expect(page.getByText(unknown.title, { exact: true })).toBeVisible();

  await page.getByRole("combobox", { name: "Комнат", exact: true }).click();
  await page.getByRole("option", { name: "Студия", exact: true }).click();
  await expect(page.getByRole("checkbox")).toHaveCount(1);
  await expect(page.getByRole("checkbox")).toHaveAccessibleName(
    "Выбрать Студия у моря (ID n-studio)",
  );
  await page
    .getByRole("button", { name: "Создать черновики (1)", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Студия у моря — открыть черновик" }),
  ).toHaveAttribute("href", "/morskoy-kabinet-7q4x/properties/draft-n-studio");
  expect(imported).toEqual([studio.id]);
  await expect(page.getByRole("checkbox")).toHaveCount(0);

  await page.getByRole("button", { name: "Обновить из Нмаркета" }).click();
  await expect(
    page.getByRole("button", { name: "Обновить из Нмаркета" }),
  ).toBeEnabled();
  expect(listOffsets).toEqual([0, 0]);
  await page.getByRole("combobox", { name: "Комнат", exact: true }).click();
  await page.getByRole("option", { name: "Студия", exact: true }).click();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Создать черновики (0)", exact: true }),
  ).toBeDisabled();
  expect(imported).toEqual([studio.id]);

  await page.getByRole("combobox", { name: "Комнат", exact: true }).click();
  await page
    .getByRole("option", { name: "Любое количество", exact: true })
    .click();
  await page.getByRole("combobox", { name: "Город", exact: true }).click();
  await page.getByRole("option", { name: "Калининград", exact: true }).click();
  await page.getByRole("combobox", { name: "Застройщик", exact: true }).click();
  await page
    .getByRole("option", { name: "Второй застройщик", exact: true })
    .click();
  await expect(page.getByRole("checkbox")).toHaveCount(1);
  await expect(page.getByRole("checkbox")).toHaveAccessibleName(
    "Выбрать Просторная квартира (ID n-apartment)",
  );
  await page.getByRole("combobox", { name: "Категория Нмаркета" }).click();
  await page.getByRole("option", { name: "Квартиры", exact: true }).click();
  await page.getByRole("button", { name: "Выбрать категорию" }).click();
  await expect(page.getByRole("checkbox")).toBeChecked();
  await page
    .getByRole("button", { name: "Создать черновики (1)", exact: true })
    .click();
  await expect(
    page.getByRole("link", {
      name: "Просторная квартира — уже добавлен, открыть",
    }),
  ).toHaveAttribute(
    "href",
    "/morskoy-kabinet-7q4x/properties/draft-n-apartment",
  );
  expect(imported).toEqual([studio.id, apartment.id]);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Создать черновики (0)", exact: true }),
  ).toBeDisabled();
});

test("Nmarket selection and search cover all pages of the received list", async ({
  page,
}) => {
  const items = Array.from({ length: 55 }, (_, index) => ({
    id: `apartment:${index + 1}`,
    title: `Квартира ${String(index + 1).padStart(2, "0")}`,
    category: "Квартиры",
    location: "Калининград",
    address: `Тестовая, ${index + 1}`,
    price: 4000000 + index * 100000,
    area: 25 + index,
    bedrooms: 1,
    floors: 10,
    developer: "Застройщик",
    supported: true,
    existingId: null,
  }));
  await page.route("**/api/admin/nmarket/objects?*", (route) =>
    route.fulfill({ json: { items, nextOffset: null } }),
  );
  await page.goto("/morskoy-kabinet-7q4x/properties/import?source=nmarket");
  await expect(page.getByRole("checkbox")).toHaveCount(50);
  const pagination = page.getByRole("navigation", { name: "Страницы списка" });
  await expect(pagination).toContainText("Страница 1 из 2");
  await pagination.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(page.getByRole("checkbox")).toHaveCount(5);
  await page.getByRole("button", { name: "Выбрать все найденные" }).click();
  await expect(
    page.getByRole("button", { name: "Создать черновики (55)", exact: true }),
  ).toBeEnabled();
  await expect(
    page.locator('tbody input[type="checkbox"]:checked'),
  ).toHaveCount(5);
  await pagination.getByRole("button", { name: "Назад", exact: true }).click();
  await expect(
    page.locator('tbody input[type="checkbox"]:checked'),
  ).toHaveCount(50);
  await page.getByRole("button", { name: "Снять выбор", exact: true }).click();
  await expect(
    page.locator('tbody input[type="checkbox"]:checked'),
  ).toHaveCount(0);

  const search = page.getByRole("textbox", { name: "Поиск объектов Нмаркета" });
  await search.fill("apartment:55");
  await expect(page.getByRole("checkbox")).toHaveCount(1);
  await expect(page.getByRole("checkbox")).toHaveAccessibleName(
    "Выбрать Квартира 55 (ID apartment:55)",
  );
  await page.getByRole("button", { name: "Выбрать все найденные" }).click();
  await expect(
    page.getByRole("button", { name: "Создать черновики (1)", exact: true }),
  ).toBeEnabled();
  await search.fill("");
  await expect(pagination).toContainText("Страница 1 из 2");
  await expect(
    page.locator('tbody input[type="checkbox"]:checked'),
  ).toHaveCount(0);
  await pagination.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(
    page.locator('tbody input[type="checkbox"]:checked'),
  ).toHaveCount(1);
  await expect(
    page.getByRole("checkbox", {
      name: "Выбрать Квартира 55 (ID apartment:55)",
      exact: true,
    }),
  ).toBeChecked();
});

test("Nmarket opens the saved export automatically and keeps live refresh explicit", async ({
  page,
}) => {
  const items = [1, 2].map((id) => ({
    id: `apartment:${900 + id}`,
    title: `Квартира из сохранённой выгрузки ${id}`,
    category: "Квартиры",
    location: "Калининград",
    address: `Тестовая, ${id}`,
    price: 5000000,
    area: 40,
    bedrooms: 1,
    floors: 10,
    developer: "Застройщик",
    supported: true,
    existingId: null,
  }));
  const requestedSnapshots: (string | null)[] = [];
  const imported: unknown[] = [];
  await page.route("**/api/admin/nmarket/objects?*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    requestedSnapshots.push(params.get("snapshot"));
    expect(params.get("offset")).toBe("0");
    if (params.get("snapshot") === "saved") {
      expect(params.has("refresh")).toBe(false);
      await route.fulfill({
        json: {
          items,
          nextOffset: null,
          snapshotDate: "2026-10-19T12:00:00.000Z",
        },
      });
    } else {
      expect(params.get("refresh")).toBe("1");
      await route.fulfill({
        status: 502,
        json: {
          statusCode: 502,
          data: { message: "Свежая выгрузка недоступна" },
        },
      });
    }
  });
  await page.route("**/api/admin/nmarket/import", async (route) => {
    imported.push(route.request().postDataJSON());
    await route.fulfill({
      json: { id: "saved-draft", created: true, warnings: [] },
    });
  });
  await page.goto("/morskoy-kabinet-7q4x/properties/import?source=nmarket");
  await expect(
    page.getByRole("button", {
      name: "Открыть сохранённую выгрузку",
      exact: true,
    }),
  ).toHaveCount(0);
  const snapshotDate = page.getByText(/19[.\s](?:10|октября)[.\s]2026/);
  await expect(snapshotDate).toBeVisible();
  expect(requestedSnapshots).toEqual(["saved"]);
  await expect(
    page.getByRole("button", {
      name: "Перечитать сохранённую выгрузку",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Обновить из Нмаркета",
      exact: true,
    }),
  ).toBeEnabled();
  await page.getByRole("checkbox").first().check();
  await page
    .getByRole("button", { name: "Создать черновики (1)", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: `${items[0].title} — открыть черновик` }),
  ).toHaveAttribute("href", "/morskoy-kabinet-7q4x/properties/saved-draft");
  expect(imported).toEqual([{ id: items[0].id, snapshot: "saved" }]);

  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Обновить из Нмаркета", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Свежая выгрузка недоступна",
  );
  expect(requestedSnapshots).toEqual(["saved", null]);
  await expect(snapshotDate).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByText(items[0].title, { exact: true })).toHaveCount(0);
  await expect(page.getByText(items[1].title, { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Результаты импорта" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^Создать черновики/ }),
  ).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("checkbox")).toHaveCount(2);
  expect(requestedSnapshots).toEqual(["saved", null, "saved"]);
  await expect(
    page.locator('tbody input[type="checkbox"]:checked'),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Создать черновики (0)", exact: true }),
  ).toBeDisabled();
});

test("Nmarket reports an unavailable saved export without silently making a live request", async ({ page }) => {
  const snapshots: (string | null)[] = [];
  await page.route('**/api/admin/nmarket/objects?*', async route => {
    snapshots.push(new URL(route.request().url()).searchParams.get('snapshot'));
    await route.fulfill({ status: 503, json: { data: { message: 'Сохранённая выгрузка недоступна' } } });
  });
  await page.goto('/morskoy-kabinet-7q4x/properties/import?source=nmarket');
  await expect(page.getByRole('alert')).toContainText('Сохранённая выгрузка недоступна');
  expect(snapshots).toEqual(['saved']);
  await expect(page.getByRole('button', { name: 'Обновить из Нмаркета', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Открыть сохранённую выгрузку', exact: true })).toHaveCount(0);
});
