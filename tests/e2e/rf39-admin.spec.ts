import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";

const env = { ...parseEnv(await readFile(".env", "utf8")), ...process.env };

test("CRM import resumes listing, keeps drafts and reuses saved lists with an animated source switch", async ({
  page,
}, testInfo) => {
  const login = await page.request.post("/api/admin/login", {
    headers: {
      Origin: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3100",
    },
    data: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
  });
  expect(login.ok()).toBe(true);

  const first = {
    id: 101,
    title: "Первый корпус",
    category: "ЖК",
    location: "Калининград",
    address: "Первый адрес",
    price: 5000000,
    layoutCount: 12,
    supported: true,
    existingId: null,
  };
  const second = {
    ...first,
    id: 102,
    title: "Второй корпус",
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
  await page.route("**/api/admin/rf39/import", async (route) => {
    const { id } = route.request().postDataJSON();
    imported.push(id);
    if (id === 102 && failImport) {
      failImport = false;
      await route.fulfill({
        status: 503,
        json: {
          statusCode: 503,
          data: { message: "Не удалось загрузить фото" },
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        id: `draft-${id}`,
        created: true,
        warnings: id === 101 ? ["Проверьте цену перед публикацией."] : [],
      },
    });
  });

  await page.goto("/morskoy-kabinet-7q4x/properties/import");
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
  ).toHaveAttribute("href", "/morskoy-kabinet-7q4x/properties/existing-draft");

  await page.getByRole("button", { name: "Продолжить загрузку" }).click();
  await expect(
    page.getByRole("button", { name: "Обновить из CRM" }),
  ).toBeEnabled();
  expect(listOffsets).toEqual([0, 3, 3]);
  await expect(page.getByRole("checkbox")).toHaveCount(2);
  await expect(page.getByText("Первый корпус", { exact: true })).toHaveCount(1);
  await page.getByRole("textbox", { name: "Поиск объектов CRM" }).fill("102");
  await expect(page.getByRole("checkbox")).toHaveCount(1);
  await expect(page.getByRole("checkbox")).toHaveAccessibleName(
    "Выбрать Второй корпус (ID 102)",
  );
  await page.getByRole("textbox", { name: "Поиск объектов CRM" }).fill("");
  await page.getByRole("combobox", { name: "Категория CRM" }).click();
  await page.getByRole("option", { name: "ЖК", exact: true }).click();
  await page.getByRole("button", { name: "Выбрать категорию" }).click();
  await expect(page.getByRole("checkbox").first()).toBeChecked();
  await expect(page.getByRole("checkbox").last()).toBeChecked();
  await page
    .getByRole("button", { name: "Создать черновики (2)", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Не удалось загрузить фото",
  );
  expect(imported).toEqual([101, 102]);
  await expect(
    page.getByRole("link", { name: "Первый корпус — открыть черновик" }),
  ).toHaveAttribute("href", "/morskoy-kabinet-7q4x/properties/draft-101");
  await expect(
    page.getByText("Проверьте цену перед публикацией."),
  ).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(1);
  await expect(page.getByRole("checkbox")).toBeChecked();

  await page
    .getByRole("button", { name: "Создать черновики (1)", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Второй корпус — открыть черновик" }),
  ).toHaveAttribute("href", "/morskoy-kabinet-7q4x/properties/draft-102");
  expect(imported).toEqual([101, 102, 102]);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Создать черновики (0)", exact: true }),
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
  await expect(page.getByText("Первый корпус", { exact: true })).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Выбрать категорию" }),
  ).toBeDisabled();
  repeatedItems = false;
  await page.getByRole("button", { name: "Продолжить загрузку" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "CRM повторила страницу списка",
  );
  expect(repeatedOffsets).toEqual([0, 1, 1]);
  await expect(page.getByText("Второй корпус", { exact: true })).toHaveCount(0);

  await page.unroute("**/api/admin/rf39/objects?*");
  let changingPage = 0;
  await page.route("**/api/admin/rf39/objects?*", async (route) => {
    changingPage++;
    await route.fulfill({ json: changingPage === 1
      ? { items: [first], nextOffset: 1, snapshotDate: '2026-10-23T07:00:00.000Z' }
      : { items: [second], nextOffset: null, snapshotDate: '2026-10-23T08:00:00.000Z' } });
  });
  await page.reload();
  await expect(page.getByText("Второй корпус", { exact: true })).toBeVisible();
  await expect(page.getByText("Первый корпус", { exact: true })).toHaveCount(0);
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
  await expect(page.getByText("Первый корпус", { exact: true })).toBeVisible();
  await expect(page.locator('.import-snapshot-note')).toContainText('23.10.2026, 11:15');
  expect(refreshFlags).toEqual([null]);
  await page.getByRole("button", { name: "Обновить из CRM" }).click();
  await expect(page.getByRole('alert')).toContainText('Продолжаем показывать сохранённую выгрузку');
  await expect(page.getByText("Первый корпус", { exact: true })).toBeVisible();
  expect(refreshFlags).toEqual([null, '1']);

  await page.getByRole('textbox', { name: 'Поиск объектов CRM' }).fill('Первый');
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
  await expect(page.getByText("Первый корпус", { exact: true })).toHaveCount(0);
  await expect(page.locator('.import-snapshot-note')).toContainText('19.10.2026');
  await page.getByRole('button', { name: 'CRM RF39', exact: true }).click();
  await expect(page.getByText("Первый корпус", { exact: true })).toBeVisible();
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
