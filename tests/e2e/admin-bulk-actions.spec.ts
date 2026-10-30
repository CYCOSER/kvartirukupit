import { test, expect, type Page } from "@playwright/test";

const base = {
  id: "one",
  title: "Квартира у парка",
  type: "apartment",
  location: "Калининград",
  address: "",
  price: 5000000,
  area: 50,
  status: "available",
  published: false,
  featured: true,
  housingMarket: "newbuild" as string | null,
  elite: false,
  demo: false,
  images: [],
  sourceUrl: null,
};
type Item = typeof base;

async function catalog(page: Page, initial: Item[], failFirst = false) {
  let items = initial.map((item) => ({ ...item }));
  const requests: { action: string; ids: string[] }[] = [];
  await page.route("**/api/admin/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/admin/login" || path === "/api/admin/me") {
      await route.fulfill({ json: { ok: true } });
    } else if (path === "/api/admin/properties") {
      expect(new URL(route.request().url()).searchParams.get("view")).toBe(
        "list",
      );
      await route.fulfill({ json: items });
    } else if (path === "/api/admin/properties/bulk") {
      const body = route.request().postDataJSON();
      requests.push(body);
      if (failFirst && requests.length === 1) {
        await route.fulfill({
          status: 500,
          json: { message: "Temporary failure" },
        });
        return;
      }
      const selected = items.filter((item) => body.ids.includes(item.id));
      if (body.action === "delete")
        items = items.filter((item) => !body.ids.includes(item.id));
      else
        selected.forEach((item) => {
          item.published = body.action === "publish";
        });
      await route.fulfill({ json: { count: selected.length } });
    } else {
      await route.fulfill({
        status: 404,
        json: { message: "Unexpected test request" },
      });
    }
  });
  await page.goto("/admin-console-9Xk6uiIs/login");
  await page.waitForFunction(
    () => !!(document.querySelector("#__nuxt") as any)?.__vue_app__,
  );
  await page.getByLabel("Email", { exact: true }).fill("test@example.com");
  await page.getByLabel("Пароль", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "ЖК и квартиры", exact: true }),
  ).toBeVisible();
  return requests;
}

test("select all follows filters; publication, manual selection and confirmed deletion work", async ({
  page,
}) => {
  const requests = await catalog(page, [
    base,
    { ...base, id: "two", title: "Квартира у моря" },
    { ...base, id: "three", title: "Жилой комплекс", type: "complex" },
  ]);
  const actions = page.getByRole("group", { name: "Массовые действия" });
  const search = page.getByRole("textbox", {
    name: "Поиск объектов",
    exact: true,
  });
  await expect(
    actions.getByRole("button", { name: "Опубликовать", exact: true }),
  ).toBeDisabled();
  await search.fill("Квартира");
  await actions
    .getByRole("button", { name: "Выбрать все", exact: true })
    .click();
  await expect(actions).toContainText("Выбрано: 2");
  await actions
    .getByRole("button", { name: "Опубликовать", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Опубликовано: 2." }),
  ).toBeVisible();
  expect(requests[0]).toEqual({ action: "publish", ids: ["one", "two"] });
  await expect(actions).toContainText("Выбрано: 0");
  await actions
    .getByRole("button", { name: "Выбрать все", exact: true })
    .click();
  await page
    .getByRole("checkbox", {
      name: "Выбрать объект «Квартира у моря»",
      exact: true,
    })
    .uncheck();
  await actions
    .getByRole("button", { name: "Снять с публикации", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Снято с публикации: 1." }),
  ).toBeVisible();
  expect(requests[1]).toEqual({ action: "unpublish", ids: ["one"] });
  await actions
    .getByRole("button", { name: "Выбрать все", exact: true })
    .click();
  await search.fill("у моря");
  await expect(actions).toContainText("Выбрано: 1");
  await actions
    .getByRole("button", { name: "Удалить выбранные", exact: true })
    .click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Объектов к удалению: 1.");
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  expect(requests).toHaveLength(2);
  await actions
    .getByRole("button", { name: "Удалить выбранные", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Удалено: 1." }),
  ).toBeVisible();
  expect(requests[2]).toEqual({ action: "delete", ids: ["two"] });
  await expect(
    actions.getByRole("button", { name: "Выбрать все", exact: true }),
  ).toBeDisabled();
  await search.fill("");
  await expect(page.locator(".admin-property-name")).toHaveText([
    base.title,
    "Жилой комплекс",
  ]);
  await page.setViewportSize({ width: 390, height: 844 });
  await actions
    .getByRole("button", { name: "Выбрать все", exact: true })
    .click();
  await expect(actions).toContainText("Выбрано: 2");
  await actions
    .getByRole("button", { name: "Снять выбор", exact: true })
    .click();
  await expect(actions).toContainText("Выбрано: 0");
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("bulk-mobile.png"),
    fullPage: true,
  });
});

test("homepage and apartment market filters combine and limit bulk selection", async ({
  page,
}) => {
  const requests = await catalog(page, [
    base,
    {
      ...base,
      id: "two",
      title: "Вторичная квартира",
      housingMarket: "secondary",
      published: true,
    },
    {
      ...base,
      id: "three",
      title: "Квартира без рынка",
      housingMarket: null,
      featured: false,
    },
    {
      ...base,
      id: "four",
      title: "Жилой комплекс",
      type: "complex",
      housingMarket: null,
    },
  ]);
  const names = page.locator(".admin-property-name");
  const actions = page.getByRole("group", { name: "Массовые действия" });
  async function filter(label: string, option: string) {
    await page.getByRole("combobox", { name: label, exact: true }).click();
    await page.getByRole("option", { name: option, exact: true }).click();
  }
  await filter("На главной", "Да");
  await expect(names).toHaveText([
    base.title,
    "Вторичная квартира",
    "Жилой комплекс",
  ]);
  await actions
    .getByRole("button", { name: "Выбрать все", exact: true })
    .click();
  await filter("Рынок квартиры", "Вторичка");
  await expect(names).toHaveText(["Вторичная квартира"]);
  await expect(actions).toContainText("Выбрано: 1");
  await actions
    .getByRole("button", { name: "Снять с публикации", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Снято с публикации: 1." }),
  ).toBeVisible();
  expect(requests[0]).toEqual({ action: "unpublish", ids: ["two"] });
  await filter("Рынок квартиры", "Новостройка");
  await expect(names).toHaveText([base.title]);
  await filter("Публикация объекта", "Опубликованные");
  await expect(names).toHaveCount(0);
  await page
    .getByRole("button", { name: "Сбросить фильтры", exact: true })
    .click();
  await expect(names).toHaveCount(4);
  await filter("Рынок квартиры", "Не указан");
  await expect(names).toHaveText(["Квартира без рынка"]);
  await filter("На главной", "Нет");
  await expect(names).toHaveText(["Квартира без рынка"]);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("combobox", { name: "На главной", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Рынок квартиры", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

test("catalog pages preserve selection and apply actions across all filtered pages", async ({
  page,
}) => {
  const items = Array.from({ length: 55 }, (_, i) => ({
    ...base,
    id: `item-${i}`,
    title: `Квартира ${String(i + 1).padStart(3, "0")}`,
    featured: i % 2 === 0,
  }));
  const requests = await catalog(page, items);
  const pagination = page.getByRole("navigation", {
    name: "Страницы объектов",
  });
  const actions = page.getByRole("group", { name: "Массовые действия" });
  const rows = page.locator(".admin-properties-table tbody tr");
  const names = page.locator(".admin-property-name");
  async function pageSize(size: string) {
    await page
      .getByRole("combobox", { name: "Объектов на странице", exact: true })
      .click();
    await page.getByRole("option", { name: size, exact: true }).click();
  }
  await expect(rows).toHaveCount(20);
  await expect(pagination).toContainText("Страница 1 из 3");
  await expect(
    pagination.getByRole("button", { name: "Назад", exact: true }),
  ).toBeDisabled();
  await rows
    .first()
    .getByRole("button", { name: "Черновик", exact: true })
    .click();
  await expect(
    rows.first().getByRole("button", { name: "Опубликован", exact: true }),
  ).toBeVisible();
  expect(requests.at(-1)).toEqual({ action: "publish", ids: ["item-0"] });
  await pagination.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(names.first()).toHaveText("Квартира 021");
  await rows.first().getByRole("checkbox").check();
  await pagination.getByRole("button", { name: "Назад", exact: true }).click();
  await expect(actions).toContainText("Выбрано: 1");
  await actions
    .getByRole("button", { name: "Выбрать все", exact: true })
    .click();
  await expect(actions).toContainText("Выбрано: 55");
  await pageSize("10");
  await expect(rows).toHaveCount(10);
  await expect(pagination).toContainText("Страница 1 из 6");
  await pageSize("50");
  await expect(rows).toHaveCount(50);
  await pagination.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(rows).toHaveCount(5);
  await expect(pagination).toContainText("Страница 2 из 2");
  await expect(
    pagination.getByRole("button", { name: "Далее", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(5);
  await actions
    .getByRole("button", { name: "Снять с публикации", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Снято с публикации: 55." }),
  ).toBeVisible();
  expect(requests.at(-1)).toEqual({
    action: "unpublish",
    ids: items.map((item) => item.id),
  });
  await expect(actions).toContainText("Выбрано: 0");
  for (const checkbox of await rows.getByRole("checkbox").all())
    await checkbox.check();
  await actions
    .getByRole("button", { name: "Удалить выбранные", exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Удалить", exact: true })
    .click();
  await expect(pagination).toContainText("Страница 1 из 1");
  await expect(rows).toHaveCount(50);
  expect(requests.at(-1)).toEqual({
    action: "delete",
    ids: items.slice(50).map((item) => item.id),
  });
  await pageSize("10");
  await pagination.getByRole("button", { name: "Далее", exact: true }).click();
  await page.getByRole("combobox", { name: "На главной", exact: true }).click();
  await page.getByRole("option", { name: "Да", exact: true }).click();
  await expect(pagination).toContainText("Страница 1 из 3");
  await actions
    .getByRole("button", { name: "Выбрать все", exact: true })
    .click();
  await expect(actions).toContainText("Выбрано: 25");
  await pagination.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(10);
  await page
    .getByRole("button", {
      name: "Сортировать по названию по возрастанию",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", {
      name: "Сортировать по названию по убыванию",
      exact: true,
    })
    .click();
  await expect(pagination).toContainText("Страница 1 из 3");
  await expect(names.first()).toHaveText("Квартира 049");
  await actions
    .getByRole("button", { name: "Опубликовать", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Опубликовано: 25." }),
  ).toBeVisible();
  expect(requests.at(-1)!.ids).toEqual(
    items
      .slice(0, 50)
      .filter((item) => item.featured)
      .map((item) => item.id),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    pagination.getByRole("button", { name: "Далее", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

test("large selections continue after a failed batch and retain failures for retry", async ({
  page,
}) => {
  const requests = await catalog(
    page,
    Array.from({ length: 1001 }, (_, i) => ({ ...base, id: `item-${i}` })),
    true,
  );
  const actions = page.getByRole("group", { name: "Массовые действия" });
  await actions
    .getByRole("button", { name: "Выбрать все", exact: true })
    .click();
  await expect(actions).toContainText(/Выбрано: 1\s001/);
  await expect(page.locator(".admin-properties-table tbody tr")).toHaveCount(
    20,
  );
  await actions
    .getByRole("button", { name: "Опубликовать", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Опубликовано: 501. Не удалось обработать: 500." }),
  ).toBeVisible();
  expect(requests.map((request) => request.ids.length)).toEqual([500, 500, 1]);
  await expect(actions).toContainText("Выбрано: 500");
  await actions
    .getByRole("button", { name: "Опубликовать", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Опубликовано: 500." }),
  ).toBeVisible();
  expect(requests[3]!.ids).toEqual(requests[0]!.ids);
  await expect(actions).toContainText("Выбрано: 0");
});
