import { test, expect } from "@playwright/test";

test("admin catalog filters combine, reset and stay usable on mobile", async ({
  page,
}) => {
  const base = {
    id: "apartment-a",
    title: "Квартира у парка",
    type: "apartment",
    location: "Калининград",
    address: "Парковая, 10",
    price: 5000000,
    area: 50,
    status: "available",
    published: true,
    elite: false,
    demo: false,
    images: [{ file: "/images/journal-dunes.webp", alt: "" }],
    sourceUrl: null,
  };
  const items = [
    base,
    {
      ...base,
      id: "apartment-b",
      title: "Квартира у моря",
      price: 9000000,
      area: 90,
      status: "reserved",
      published: false,
      elite: true,
    },
    {
      ...base,
      id: "complex-c",
      title: "Новый квартал",
      type: "complex",
      price: null,
      area: null,
      published: false,
      status: "sold",
      images: [],
    },
  ];
  // All admin requests are fixtures: this test never changes real catalog data.
  await page.route("**/api/admin/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/admin/login" || path === "/api/admin/me") {
      await route.fulfill({ json: { ok: true } });
    } else if (path === "/api/admin/properties") {
      await route.fulfill({ json: items });
    } else {
      await route.fulfill({
        status: 404,
        json: { message: "Unexpected test request" },
      });
    }
  });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto("/morskoy-kabinet-7q4x/login");
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__);
  await page.getByLabel("Email", { exact: true }).fill("test@example.com");
  await page.getByLabel("Пароль", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "ЖК и квартиры", exact: true }),
  ).toBeVisible();
  const rows = page.locator(".admin-properties-table tbody tr");
  await expect(rows).toHaveCount(3);
  await expect(
    page.getByRole("link", { name: "Импорт из CRM", exact: true }),
  ).toHaveAttribute("href", "/morskoy-kabinet-7q4x/properties/import");
  await expect(
    page.getByRole("link", { name: "Импорт из Нмаркета", exact: true }),
  ).toHaveAttribute(
    "href",
    "/morskoy-kabinet-7q4x/properties/import?source=nmarket",
  );
  await expect(
    page.locator(".admin-property-thumb img").first(),
  ).toHaveAttribute("src", base.images[0].file);

  const rowNames = page.locator(".admin-property-name");
  const names = [base.title, items[1]!.title, items[2]!.title];
  const sortingCases = [
    {
      label: "названию",
      ascending: [names[1], names[0], names[2]],
      descending: [names[2], names[0], names[1]],
    },
    {
      label: "цене",
      ascending: names,
      descending: [names[1], names[0], names[2]],
    },
    {
      label: "площади",
      ascending: names,
      descending: [names[1], names[0], names[2]],
    },
    { label: "статусу", ascending: names, descending: [...names].reverse() },
    {
      label: "публикации",
      ascending: [names[1], names[2], names[0]],
      descending: names,
    },
  ];
  await expect(
    page
      .getByRole("columnheader", { name: "Действия", exact: true })
      .getByRole("button"),
  ).toHaveCount(0);
  for (const { label, ascending, descending } of sortingCases) {
    await page
      .getByRole("button", {
        name: `Сортировать по ${label} по возрастанию`,
        exact: true,
      })
      .click();
    await expect(rowNames).toHaveText(ascending as string[]);
    await expect(page.locator('th[aria-sort="ascending"]')).toHaveCount(1);
    await page
      .getByRole("button", {
        name: `Сортировать по ${label} по убыванию`,
        exact: true,
      })
      .click();
    await expect(rowNames).toHaveText(descending as string[]);
    await expect(page.locator('th[aria-sort="descending"]')).toHaveCount(1);
  }

  await page
    .getByRole("combobox", { name: "Тип объекта", exact: true })
    .click();
  await page
    .getByRole("option", { name: "Элитная квартира", exact: true })
    .click();
  await expect(rowNames).toHaveText([items[1]!.title]);
  await page
    .getByRole("combobox", { name: "Тип объекта", exact: true })
    .click();
  await page.getByRole("option", { name: "Квартира", exact: true }).click();
  await expect(rowNames).toHaveText([base.title]);
  await page
    .getByRole("button", { name: "Сбросить фильтры", exact: true })
    .click();

  await page
    .getByRole("spinbutton", { name: "Цена от", exact: true })
    .fill("5000000");
  await page
    .getByRole("spinbutton", { name: "Цена до", exact: true })
    .fill("9000000");
  await page
    .getByRole("spinbutton", { name: "Площадь от", exact: true })
    .fill("50");
  await page
    .getByRole("spinbutton", { name: "Площадь до", exact: true })
    .fill("50");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Квартира у парка");
  await page
    .getByRole("spinbutton", { name: "Площадь до", exact: true })
    .fill("90");
  await expect(rows).toHaveCount(2);
  await page
    .getByRole("combobox", { name: "Публикация объекта", exact: true })
    .click();
  await page.getByRole("option", { name: "Черновики", exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Квартира у моря");
  await page
    .getByRole("textbox", { name: "Поиск объектов", exact: true })
    .fill(" У ПАРКА ");
  await expect(
    page.getByText("Объекты не найдены.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Сбросить фильтры", exact: true })
    .click();
  await expect(rows).toHaveCount(3);
  await page
    .getByRole("combobox", { name: "Тип объекта", exact: true })
    .click();
  await page
    .getByRole("option", { name: "Жилой комплекс", exact: true })
    .click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Новый квартал");
  await page
    .getByRole("button", { name: "Сбросить фильтры", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Каталог объектов", exact: true })
    .click();
  await page
    .getByRole("option", { name: "Элитные квартиры", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Статус объекта", exact: true })
    .click();
  await page.getByRole("option", { name: "Забронирован", exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Квартира у моря");
  await page
    .getByRole("button", { name: "Сбросить фильтры", exact: true })
    .click();
  await page.screenshot({
    path: test.info().outputPath("admin-desktop.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("link", { name: "Добавить объект", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Каталог объектов", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("textbox", { name: "Поиск объектов", exact: true })
    .fill("  ПАРКОВАЯ  ");
  await expect(rows).toHaveCount(3);
  await page.screenshot({
    path: test.info().outputPath("admin-mobile.png"),
    fullPage: true,
  });
});
