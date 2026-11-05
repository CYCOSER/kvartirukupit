import { expect } from "@playwright/test";
import { test } from './fixtures/admin-session';
import { mockImportJobs, openImportResults } from './fixtures/import-jobs';

for (const source of ["rf39", "nmarket"] as const) {
  const actionName = source === 'rf39' ? 'Опубликовать квартиры' : 'Создать черновики';
  const resultAction = source === 'rf39' ? 'открыть карточку' : 'открыть черновик';
  test(`${source} bulk import skips failed objects and retries only failures`, async ({ page }) => {
    const items = Array.from({ length: 5 }, (_, index) => ({
      id: source === "rf39" ? 201 + index : `n-bulk-${index}`,
      title: `Квартира ${index + 1}`, category: "Квартиры", location: "Калининград",
      address: `Тестовый адрес ${index + 1}`, price: 5000000, area: 45, bedrooms: 1, floors: 5,
      layoutCount: 0, supported: true, existingId: null,
    }));
    const failures = [
      { item: items[1], reason: "Не удалось загрузить фото" },
      { item: items[3], reason: "Некорректная площадь объекта" },
    ];
    const imported: (string | number)[] = [];
    await page.route(`**/api/admin/${source}/objects?*`, (route) => route.fulfill({
      json: { items, nextOffset: null },
    }));
    await mockImportJobs(page, { importItem: async (importSource, { id }, snapshot) => {
      expect(importSource).toBe(source);
      expect(snapshot).toBe(source === "nmarket" ? "saved" : undefined);
      const failure = failures.find(({ item }) => item.id === id);
      const firstAttempt = !imported.includes(id);
      imported.push(id);
      if (failure && firstAttempt) {
        throw new Error(failure.reason);
      } else {
        return { id: `draft-${id}`, created: id !== items[4].id, warnings: [] };
      }
    } });

    await page.goto(`/admin-console-9Xk6uiIs/properties/import?source=${source}`);
    await page.getByRole("button", { name: "Выбрать все найденные", exact: true }).click();
    await page.getByRole("button", { name: `${actionName} (5)`, exact: true }).click();
    await expect(page.locator(".import-progress")).toContainText("Обработано: 5 из 5");
    await expect(page.locator(".import-progress")).toContainText("Создано: 2 · Уже добавлены: 1 · Пропущено: 2");
    expect(imported).toEqual(items.map(({ id }) => id));
    await expect(page.getByRole("progressbar", { name: "Ход импорта" })).toHaveAttribute("value", "5");
    await expect(page.getByRole("checkbox")).toHaveCount(2);
    await expect(page.getByRole("alert")).toContainText("Пропущено: 2.");
    for (const { item, reason } of failures) {
      await expect(page.locator('.import-page').getByRole("alert")).toContainText(`${item.title} (ID ${item.id})`);
      await expect(page.getByRole("alert")).toContainText(reason);
      await expect(page.getByRole("checkbox", { name: `Выбрать ${item.title} (ID ${item.id})`, exact: true })).toBeChecked();
    }
    await openImportResults(page);
    for (const item of items.filter((_, index) => index % 2 === 0)) {
      const action = item.id === items[4].id ? "уже добавлен, открыть" : resultAction;
      await expect(page.getByRole("link", { name: `${item.title} — ${action}`, exact: true }))
        .toHaveAttribute("href", `/admin-console-9Xk6uiIs/properties/draft-${item.id}`);
    }

    await page.getByRole("button", { name: `${actionName} (2)`, exact: true }).click();
    await expect(page.locator(".import-progress")).toContainText("Обработано: 2 из 2");
    await expect(page.locator(".import-progress")).toContainText("Создано: 2 · Уже добавлены: 0 · Пропущено: 0");
    expect(imported).toEqual([...items.map(({ id }) => id), ...failures.map(({ item }) => item.id)]);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(page.getByRole("button", { name: `${actionName} (0)`, exact: true })).toBeDisabled();
    await openImportResults(page);
    for (const { item } of failures) {
      await expect(page.getByRole("link", { name: `${item.title} — ${resultAction}`, exact: true })).toBeVisible();
    }
  });
}

test("CRM import resumes listing, publishes apartments and reuses saved lists with an animated source switch", async ({
  page,
}, testInfo) => {
  const first = {
    id: 101,
    title: "Первая квартира",
    category: "Квартиры",
    location: "Калининград",
    address: "Первый адрес",
    price: 5000000,
    layoutCount: 0,
    supported: true,
    existingId: null,
  };
  const second = {
    ...first,
    id: 102,
    title: "Вторая квартира",
    address: "Второй адрес",
  };
  const listOffsets: number[] = [];
  let failList = true;
  await page.route("**/api/admin/rf39/objects?*", async (route) => {
    const offset = Number(
      new URL(route.request().url()).searchParams.get("offset"),
    );
    listOffsets.push(offset);
    if (offset === 3 && failList) {
      failList = false;
      await route.fulfill({
        status: 503,
        json: { statusCode: 503, data: { message: "CRM временно недоступна" } },
      });
      return;
    }
    await route.fulfill({
      json:
        offset === 0
          ? {
              items: [
                first,
                {
                  ...first,
                  id: 103,
                  title: "Уже добавленный",
                  existingId: "existing-draft",
                },
                {
                  ...first,
                  id: 104,
                  title: "Частный дом",
                  category: "Дома",
                  supported: false,
                  layoutCount: 0,
                },
              ],
              nextOffset: 3,
            }
          : { items: [first, second], nextOffset: null },
    });
  });

  const imported: number[] = [];
  let failImport = true;
  await mockImportJobs(page, { importItem: async (source, { id }) => {
    expect(source).toBe('rf39');
    imported.push(Number(id));
    if (id === 102 && failImport) {
      failImport = false;
      throw new Error("Не удалось загрузить фото");
    }
    return {
      id: `draft-${id}`, created: true,
      warnings: id === 101 ? ["Проверьте цену."] : [],
    };
  } });

  await page.goto("/admin-console-9Xk6uiIs/properties/import");
  await expect(
    page.getByRole("heading", { name: "Импорт из CRM RF39" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "CRM временно недоступна",
  );
  expect(listOffsets).toEqual([0, 3]);
  await expect(
    page.getByRole("button", { name: "Выбрать все найденные" }),
  ).toBeDisabled();
  await expect(page.getByRole("checkbox")).toHaveCount(1);
  await expect(
    page.getByRole("link", { name: "Уже добавлен — открыть" }),
  ).toHaveAttribute("href", "/admin-console-9Xk6uiIs/properties/existing-draft");

  await page.getByRole("button", { name: "Продолжить загрузку" }).click();
  await expect(
    page.getByRole("button", { name: "Обновить из CRM" }),
  ).toBeEnabled();
  expect(listOffsets).toEqual([0, 3, 3]);
  await expect(page.getByRole("checkbox")).toHaveCount(2);
  await expect(page.getByText("Первая квартира", { exact: true })).toHaveCount(1);
  await page.getByRole("textbox", { name: "Поиск объектов CRM" }).fill("102");
  await expect(page.getByRole("checkbox")).toHaveCount(1);
  await expect(page.getByRole("checkbox")).toHaveAccessibleName(
    "Выбрать Вторая квартира (ID 102)",
  );
  await page.getByRole("textbox", { name: "Поиск объектов CRM" }).fill("");
  await page.getByRole("combobox", { name: "Категория CRM" }).click();
  await page.getByRole("option", { name: "Квартиры", exact: true }).click();
  await page.getByRole("button", { name: "Выбрать категорию" }).click();
  await expect(page.getByRole("checkbox").first()).toBeChecked();
  await expect(page.getByRole("checkbox").last()).toBeChecked();
  await page
    .getByRole("button", { name: "Опубликовать квартиры (2)", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Не удалось загрузить фото",
  );
  expect(imported).toEqual([101, 102]);
  await openImportResults(page);
  await expect(
    page.getByRole("link", { name: "Первая квартира — открыть карточку" }),
  ).toHaveAttribute("href", "/admin-console-9Xk6uiIs/properties/draft-101");
  await page.locator('.import-page .job-warnings > summary').click();
  await expect(
    page.getByText("Проверьте цену."),
  ).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(1);
  await expect(page.getByRole("checkbox")).toBeChecked();

  await page
    .getByRole("button", { name: "Опубликовать квартиры (1)", exact: true })
    .click();
  await expect(page.locator('.import-page .import-progress')).toContainText('Обработано: 1 из 1');
  await openImportResults(page);
  await expect(
    page.getByRole("link", { name: "Вторая квартира — открыть карточку" }),
  ).toHaveAttribute("href", "/admin-console-9Xk6uiIs/properties/draft-102");
  expect(imported).toEqual([101, 102, 102]);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Опубликовать квартиры (0)", exact: true }),
  ).toBeDisabled();

  await page.unroute("**/api/admin/rf39/objects?*");
  const repeatedOffsets: number[] = [];
  let repeatedItems = true;
  await page.route("**/api/admin/rf39/objects?*", async (route) => {
    const offset = Number(
      new URL(route.request().url()).searchParams.get("offset"),
    );
    repeatedOffsets.push(offset);
    await route.fulfill({
      json: {
        items: [repeatedItems ? first : second],
        nextOffset: repeatedItems ? offset + 1 : offset,
      },
    });
  });
  await page.getByRole("button", { name: "Обновить из CRM" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "CRM повторила страницу списка",
  );
  expect(repeatedOffsets).toEqual([0, 1]);
  await expect(page.getByText("Первая квартира", { exact: true })).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Выбрать категорию" }),
  ).toBeDisabled();
  repeatedItems = false;
  await page.getByRole("button", { name: "Продолжить загрузку" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "CRM повторила страницу списка",
  );
  expect(repeatedOffsets).toEqual([0, 1, 1]);
  await expect(page.getByText("Вторая квартира", { exact: true })).toHaveCount(0);

  await page.unroute("**/api/admin/rf39/objects?*");
  let changingPage = 0;
  await page.route("**/api/admin/rf39/objects?*", async (route) => {
    changingPage++;
    await route.fulfill({ json: changingPage === 1
      ? { items: [first], nextOffset: 1, snapshotDate: '2026-10-23T07:00:00.000Z' }
      : { items: [second], nextOffset: null, snapshotDate: '2026-10-23T08:00:00.000Z' } });
  });
  await page.reload();
  await expect(page.getByText("Вторая квартира", { exact: true })).toBeVisible();
  await expect(page.getByText("Первая квартира", { exact: true })).toHaveCount(0);
  expect(changingPage).toBe(3);
  await page.unroute("**/api/admin/rf39/objects?*");
  const refreshFlags: (string | null)[] = [];
  await page.route("**/api/admin/rf39/objects?*", async (route) => {
    const refresh = new URL(route.request().url()).searchParams.get("refresh");
    refreshFlags.push(refresh);
    await route.fulfill(refresh
      ? { status: 503, json: { data: { message: "CRM временно недоступна" } } }
      : { json: { items: [first], nextOffset: null, snapshot: "saved", snapshotDate: "2026-10-23T08:15:00.000Z" } });
  });
  await page.reload();
  await expect(page.getByText("Первая квартира", { exact: true })).toBeVisible();
  await expect(page.locator('.import-snapshot-note')).toContainText('23.10.2026, 11:15');
  expect(refreshFlags).toEqual([null]);
  await page.getByRole("button", { name: "Обновить из CRM" }).click();
  await expect(page.getByRole('alert')).toContainText('Продолжаем показывать сохранённую выгрузку');
  await expect(page.getByText("Первая квартира", { exact: true })).toBeVisible();
  expect(refreshFlags).toEqual([null, '1']);

  await page.getByRole('textbox', { name: 'Поиск объектов CRM' }).fill('Первая');
  const indicator = await page.locator('.import-source-indicator').elementHandle();
  await expect(page.locator('.import-source-indicator')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await indicator!.evaluate(node => {
    node.addEventListener('transitionrun', () => node.setAttribute('data-animated', 'true'));
  });
  await page.route('**/api/admin/nmarket/objects?*', async route => {
    expect(new URL(route.request().url()).searchParams.get('snapshot')).toBe('saved');
    await route.fulfill({ json: { items: [], nextOffset: null, snapshotDate: '2026-10-19T12:00:00.000Z' } });
  });
  await page.getByRole('button', { name: 'Нмаркет', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Импорт из Нмаркета' })).toBeVisible();
  expect(await indicator!.evaluate(node => node.isConnected)).toBe(true);
  await expect(page.locator('.import-source-indicator')).toHaveAttribute('data-animated', 'true');
  await expect(page.getByRole('button', { name: 'Нмаркет', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText("Первая квартира", { exact: true })).toHaveCount(0);
  await expect(page.locator('.import-snapshot-note')).toContainText('19.10.2026');
  await page.getByRole('button', { name: 'CRM RF39', exact: true }).click();
  await expect(page.getByText("Первая квартира", { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Поиск объектов CRM' })).toHaveValue('');
  expect(await indicator!.evaluate(node => node.isConnected)).toBe(true);
  expect(refreshFlags).toEqual([null, '1', null]);
  await expect(page.locator('.import-source-indicator')).toHaveCSS('transform', 'none');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.getByRole('button', { name: 'CRM RF39', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`import-${width}.png`), fullPage: true });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.import-source-indicator')).toHaveCSS('transition-duration', '0s');
});
