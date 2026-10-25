import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3100";
const headers = { Origin: baseURL };
const location = "Проверка карты " + Date.now();
const fixtures: { id: string; slug: string; elite: boolean; type: string; price: number }[] = [];
let admin: APIRequestContext;

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(120000);
  const env = { ...parseEnv(await readFile(".env", "utf8")), ...process.env };
  admin = await playwright.request.newContext({ baseURL, extraHTTPHeaders: headers });
  const login = await admin.post("/api/admin/login", {
    data: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
  });
  expect(login.ok()).toBe(true);
  for (let index = 0; index < 18; index++) {
    const elite = index < 14;
    const samePosition = index === 12 || index === 13;
    const missingPosition = index === 11;
    const response = await admin.post("/api/admin/properties", {
      data: {
        title: `Проверка карты ${index + 1}`,
        slug: `e2e-catalog-map-${location.match(/\d+$/)![0]}-${index}`,
        type: elite || index === 17 ? "apartment" : "complex",
        location,
        address: "Временный тестовый адрес",
        latitude: missingPosition ? null : samePosition ? 54.71 : 54.65 + index * 0.015,
        longitude: missingPosition ? null : samePosition ? 20.52 : 20.35 + index * 0.025,
        price: 10000000 + index * 1000000,
        status: "available",
        area: 100 + index,
        landArea: null,
        bedrooms: 3,
        floors: 5,
        readiness: "Готова",
        finish: "Чистовая",
        seaDistance: null,
        description: "Временная карточка для проверки карты, удаляется после теста.",
        utilities: [],
        published: true,
        featured: false,
        elite,
        demo: true,
      },
    });
    expect(response.ok()).toBe(true);
    fixtures.push(await response.json());
  }
});

test.afterAll(async () => {
  if (!admin) return;
  const failures: string[] = [];
  for (const item of fixtures) {
    const response = await admin.delete("/api/admin/properties/" + item.id);
    if (!response.ok()) failures.push(item.id);
  }
  await admin.dispose();
  expect(failures, "Temporary map objects must be removed").toEqual([]);
});

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  // Tile network availability must not hide failures in the real catalog or Leaflet markers.
  await page.route("https://tile.openstreetmap.org/**", (route) => route.fulfill({
    contentType: "image/png",
    body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO24AAAAASUVORK5CYII=", "base64"),
  }));
});

function mapResponse(page: Page, check: (query: URLSearchParams) => boolean = () => true) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/properties/map" && check(url.searchParams);
  });
}

async function expectListedIds(page: Page, ids: string[]) {
  const rows = page.getByTestId("catalog-map-item");
  await expect(rows).toHaveCount(ids.length);
  expect((await rows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-property-id")))).sort())
    .toEqual([...ids].sort());
}

function listedOrder(page: Page) {
  return page.getByTestId("catalog-map-item").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-property-id")));
}

function maxTileZoom(page: Page) {
  return page.locator(".leaflet-tile").evaluateAll((images) => Math.max(...images.map((image) => Number(new URL((image as HTMLImageElement).src).pathname.split("/")[1]))));
}

test("property pages open the matching catalog map with the requested object expanded", async ({ page }) => {
  test.setTimeout(120000);
  for (const index of [0, 14, 17, 11]) {
    const item = fixtures[index];
    await page.goto(`/catalog/${item.slug}`);
    const link = page.getByTestId("property-map-link");
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL((url) => url.pathname === (item.elite ? "/elite" : "/catalog")
      && url.searchParams.get("view") === "map"
      && url.searchParams.get("type") === item.type
      && url.searchParams.get("property") === item.id
      && url.hash === "#homes");
    const row = page.locator(`[data-testid="catalog-map-item"][data-property-id="${item.id}"]`);
    await expect(row).toHaveAttribute("data-selected", "true");
    await expect(row).toHaveAttribute("data-expanded", "true");
    await expect(row.getByTestId("catalog-map-detail")).toHaveAttribute("href", `/catalog/${item.slug}`);
    if (index === 11) await expect(row.getByText("Местоположение уточняется")).toBeVisible();
    else await expect(page.locator(`.catalog-map-pin[data-property-id="${item.id}"]`)).toHaveClass(/is-selected/);
    await page.reload();
    await expect(row).toHaveAttribute("data-expanded", "true");
  }
});

test("expanded map cards are full-card links and keep keyboard focus when opened", async ({ page }) => {
  const property = fixtures[14];
  for (const activation of ['click', 'Enter', 'Space']) {
    await page.goto(`/catalog?view=map&location=${encodeURIComponent(location)}#homes`);
    const row = page.locator(`[data-testid="catalog-map-item"][data-property-id="${property.id}"]`);
    const card = row.locator('.property-card');
    const toggle = row.getByTestId('catalog-map-toggle');
    await expect(toggle).toHaveAttribute('role', 'button');
    await expect(toggle).toHaveAttribute('aria-controls', `catalog-map-panel-${property.id}`);
    await expect(toggle).not.toHaveAttribute('href');
    const originalCard = (await card.elementHandle())!;
    const originalAction = (await toggle.elementHandle())!;
    if (activation === 'click') await toggle.click();
    else await toggle.press(activation === 'Space' ? ' ' : 'Enter');

    await expect(row).toHaveAttribute('data-expanded', 'true');
    const link = row.getByTestId('catalog-map-detail');
    await expect(link).toHaveAttribute('href', `/catalog/${property.slug}`);
    await expect(link).toBeFocused();
    await expect(row.getByRole('link')).toHaveCount(1);
    await expect(row.getByRole('button')).toHaveCount(0);
    await expect(row.getByText('Подробнее об объекте')).toHaveCount(0);
    expect(await card.evaluate((element, previous) => element === previous, originalCard)).toBe(true);
    expect(await link.evaluate((element, previous) => element === previous, originalAction)).toBe(true);
    const cardBox = (await card.boundingBox())!;
    const linkBox = (await link.boundingBox())!;
    for (const dimension of ['x', 'y', 'width', 'height'] as const)
      expect(Math.abs(cardBox[dimension] - linkBox[dimension])).toBeLessThanOrEqual(1);

    if (activation === 'Space') {
      const opened = page.context().waitForEvent('page');
      await link.click({ modifiers: ['ControlOrMeta'] });
      const tab = await opened;
      await expect(tab).toHaveURL(new RegExp(`/catalog/${property.slug}$`));
      await tab.close();
      await expect(page).toHaveURL(/view=map/);
    }
    if (activation === 'click') await card.click({ position: { x: cardBox.width / 2, y: cardBox.height / 2 } });
    else await link.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/catalog/${property.slug}$`));
  }
});

test("map is lazy, keeps filters, synchronizes selection, and survives returning from cards", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/catalog?location=${encodeURIComponent(location)}&sort=price_asc#homes`);
  await expect(page.getByTestId("catalog-map")).toHaveCount(0);
  await expect(page.locator(".leaflet-container")).toHaveCount(0);
  await expect(page.locator(".property-card")).toHaveCount(3);

  const loading = mapResponse(page);
  await page.getByRole("button", { name: "Карта", exact: true }).click();
  const response = await loading;
  expect(response.ok()).toBe(true);
  expect(new URL(response.url()).searchParams.get("location")).toBe(location);
  expect(new URL(response.url()).searchParams.get("sort")).toBe("price_asc");
  expect(new URL(response.url()).searchParams.get("elite")).toBe("false");
  const data = await response.json();
  await expectListedIds(page, fixtures.filter((item) => !item.elite && item.type === 'complex').map((item) => item.id));
  await expect(page.getByRole("button", { name: "Карта", exact: true })).toHaveAttribute("aria-pressed", "true");
  const rows = page.getByTestId("catalog-map-item");
  const originalOrder = data.items.map((item: { id: string }) => item.id);
  expect(await listedOrder(page)).toEqual(originalOrder);
  await expect(rows.first()).toHaveAttribute("data-property-id", data.items[0].id);
  await expect(rows.first()).toHaveAttribute("data-selected", "true");
  await expect(page.getByTestId("catalog-map")).toHaveCSS("border-radius", "0px");
  await expect(page.getByTestId("catalog-map")).toHaveCSS("border-top-width", "0px");
  await expect(rows.first()).toHaveCSS("border-radius", "0px");
  await expect(rows.first()).toHaveCSS("border-top-width", "0px");
  await expect(page.getByTestId("catalog-map-results")).toHaveCSS("scrollbar-width", "none");
  await expect(rows.locator(".property-card")).toHaveCount(3);
  await expect(rows.locator("h3")).toHaveCount(3);
  await expect(rows.locator(".card-price")).toHaveCount(3);
  await expect(rows.getByRole('button', { expanded: false })).toHaveCount(3);
  const collapsed = await rows.evaluateAll((nodes) => nodes.map((node) => {
    const card = node.querySelector(".property-card")!.getBoundingClientRect();
    const bodyNode = node.querySelector(".card-body")!;
    const body = bodyNode.getBoundingClientRect();
    const price = node.querySelector(".card-price strong")!.getBoundingClientRect();
    return { top: card.top, bottom: card.bottom, bodyTop: body.top, bodyBottom: body.bottom, priceBottom: price.bottom, bottomPadding: Number.parseFloat(getComputedStyle(bodyNode).paddingBottom) };
  }));
  for (let index = 0; index < collapsed.length; index++) {
    expect(Math.abs(collapsed[index].bodyTop - collapsed[index].top), "The blurred body must cover the collapsed card from the top").toBeLessThanOrEqual(1);
    expect(Math.abs(collapsed[index].bodyBottom - collapsed[index].bottom)).toBeLessThanOrEqual(1);
    expect(collapsed[index].bottom - collapsed[index].priceBottom, "Collapsed cards should not reserve blank space below the price").toBeLessThanOrEqual(collapsed[index].bottomPadding + 4);
    if (index) expect(Math.abs(collapsed[index].top - collapsed[index - 1].bottom), "Collapsed cards should meet without gaps").toBeLessThanOrEqual(1);
  }
  await expect(page.locator(".catalog-map-sidebar").getByTestId("catalog-map-search-form")).toBeVisible();
  await expect(page.getByTestId("catalog-map-search-submit")).toBeDisabled();
  await expect(page.getByTestId("catalog-map-search-submit")).toHaveCSS("opacity", "1");
  await expect(page.locator(".catalog-map-area").getByTestId("catalog-map-search-form")).toHaveCount(0);
  await expect(page.getByTestId("catalog-map-select")).toHaveCount(0);
  await expect(page.getByText("Выбранный объект — в начале списка", { exact: true })).toHaveCount(0);
  await expect(page.locator('.leaflet-control-attribution a[href*="leafletjs"]')).toHaveCount(0);
  await expect(page.locator('.leaflet-control-attribution a[href*="openstreetmap.org/copyright"]')).toBeVisible();

  const targetId = data.items[1].id;
  const targetRow = page.locator(`[data-testid="catalog-map-item"][data-property-id="${targetId}"]`);
  const originalCard = (await targetRow.locator(".property-card").elementHandle())!;
  const collapsedHeight = (await targetRow.locator(".property-card").boundingBox())!.height;
  const targetPin = page.locator(`.catalog-map-pin[data-property-id="${targetId}"]`);
  await expect(targetPin).toBeVisible();
  const sidebarScroll = await page.getByTestId("catalog-map-results").evaluate((element) => element.scrollTop);
  const body = targetPin.locator(".catalog-map-pin-body");
  const before = await body.evaluate((node) => ({ width: node.getBoundingClientRect().width, color: getComputedStyle(node).backgroundColor }));
  await targetPin.click();
  await expect(targetPin).toHaveClass(/is-selected/);
  await expect(targetRow).toHaveAttribute("data-selected", "true");
  await expect(targetRow).toHaveAttribute("data-expanded", "true");
  expect(await listedOrder(page)).toEqual(originalOrder);
  await expect(targetRow.getByTestId("catalog-map-toggle")).toHaveCount(0);
  await expect(targetRow.getByTestId("catalog-map-detail")).toHaveAttribute("href", `/catalog/${data.items[1].slug}`);
  expect(await targetRow.locator(".property-card").evaluate((node, original) => node === original, originalCard)).toBe(true);
  await expect.poll(async () => (await targetRow.locator(".property-card").boundingBox())!.height).toBeGreaterThan(collapsedHeight + 100);
  expect(await page.getByTestId("catalog-map-results").evaluate((element) => element.scrollTop)).toBe(sidebarScroll);
  await expect(rows.locator("h3")).toHaveCount(3);
  await expect(rows.locator(".card-price")).toHaveCount(3);
  await expect(rows.locator(".card-arrow")).toHaveCount(0);
  await expect.poll(() => body.evaluate((node) => node.getBoundingClientRect().width)).toBeGreaterThan(before.width);
  await expect(body).not.toHaveCSS("background-color", before.color);
  const selectedColor = await body.evaluate((node) => getComputedStyle(node).backgroundColor.match(/\d+/g)!.map(Number));
  expect(selectedColor[2], "Selected marker should use the site's blue accent").toBeGreaterThan(selectedColor[0]);

  const listId = data.items[2].id;
  const listRow = page.locator(`[data-testid="catalog-map-item"][data-property-id="${listId}"]`);
  const listCard = (await listRow.locator(".property-card").elementHandle())!;
  await listRow.getByTestId("catalog-map-toggle").click();
  await expect(listRow).toHaveAttribute("data-selected", "true");
  expect(await listedOrder(page)).toEqual(originalOrder);
  await expect(page.locator(`.catalog-map-pin[data-property-id="${listId}"]`)).toHaveClass(/is-selected/);
  await expect(rows.locator(".property-card")).toHaveCount(3);
  await expect(page.locator('[data-testid="catalog-map-item"][data-expanded="true"]')).toHaveCount(1);
  expect(await listRow.locator(".property-card").evaluate((node, original) => node === original, listCard)).toBe(true);
  await targetRow.getByTestId("catalog-map-toggle").click();
  await expect(listRow.getByTestId("catalog-map-toggle")).toHaveAttribute("aria-expanded", "false");
  expect(await listedOrder(page)).toEqual(originalOrder);
  await expect(rows.locator(".property-card")).toHaveCount(3);
  await expect(page.locator('[data-testid="catalog-map-item"][data-expanded="true"]')).toHaveCount(1);
  expect(await listRow.locator(".property-card").evaluate((node, original) => node === original, listCard)).toBe(true);

  await page.getByRole("button", { name: "Карточки", exact: true }).click();
  await expect(page.getByTestId("catalog-map")).toHaveCount(0);
  await expect(page.locator(".property-card")).toHaveCount(3);
  await page.getByRole("button", { name: "Карта", exact: true }).click();
  await expect(page.locator(".leaflet-container")).toBeVisible();
  await expectListedIds(page, data.items.map((item: { id: string }) => item.id));
  await expect(page.locator(".catalog-map-pin")).toHaveCount(3);

  const publicCatalog = await (await page.request.get("/api/properties?type=complex")).json();
  const illustrated = publicCatalog.items.find((item: { priceKind: string; price: number | null; images: unknown[] }) => item.price !== null && ["from", "minimum"].includes(item.priceKind) && item.images.length);
  expect(illustrated, "A published complex with a minimum price and photo is needed for card presentation checks").toBeTruthy();
  await page.goto(`/catalog?type=complex&q=${encodeURIComponent(illustrated.title)}#homes`);
  const illustratedCard = page.locator(`.catalog-grid .property-card[href="/catalog/${illustrated.slug}"]`);
  await expect(illustratedCard.locator(".card-price-amount small")).toHaveText("от");
  const price = await illustratedCard.locator(".card-price-amount").evaluate((element) => {
    const prefix = element.querySelector("small")!;
    const amount = element.querySelector("strong")!;
    const left = prefix.getBoundingClientRect();
    const right = amount.getBoundingClientRect();
    const text = document.createRange();
    text.selectNodeContents(amount);
    return { prefixFont: Number.parseFloat(getComputedStyle(prefix).fontSize), amountFont: Number.parseFloat(getComputedStyle(amount).fontSize), prefixRight: left.right, amountLeft: right.left, sameLine: left.top < right.bottom && left.bottom > right.top, amountLines: text.getClientRects().length };
  });
  expect(price.prefixFont).toBeLessThan(price.amountFont);
  expect(price.prefixRight).toBeLessThanOrEqual(price.amountLeft + 1);
  expect(price.sameLine).toBe(true);
  expect(price.amountLines).toBe(1);
  const focus = illustratedCard.locator(".card-photo-focus");
  await expect(focus).toBeVisible();
  await expect(focus.locator("img")).toHaveCSS("object-position", "50% 50%");
  await expect(focus.locator("img")).toHaveCSS("object-fit", "cover");
  expect(await focus.locator("img").getAttribute("src")).toBe(await illustratedCard.locator(".card-image-link img").getAttribute("src"));
  const crop = (await focus.boundingBox())!;
  const cardBounds = (await illustratedCard.boundingBox())!;
  const bodyBounds = (await illustratedCard.locator(".card-body").boundingBox())!;
  expect(Math.abs(crop.y - cardBounds.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(crop.y + crop.height - bodyBounds.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(crop.width - cardBounds.width)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test("elite map includes all pages and cannot leak ordinary objects through query parameters", async ({ page, request }) => {
  const query = `location=${encodeURIComponent(location)}&elite=true&type=complex`;
  const grid = await (await request.get("/api/properties?" + query)).json();
  const response = await request.get("/api/properties/map?" + query);
  expect(response.ok()).toBe(true);
  const map = await response.json();
  expect(grid.items).toHaveLength(12);
  expect(map.items).toHaveLength(14);
  expect(map.items.every((item: { elite: boolean; type: string }) => item.elite && item.type === "apartment")).toBe(true);

  await page.goto(`/elite?view=map&location=${encodeURIComponent(location)}&elite=false&type=complex#homes`);
  await expectListedIds(page, fixtures.filter((item) => item.elite).map((item) => item.id));
  await expect(page.getByTestId("catalog-map-item").first()).toHaveAttribute("data-selected", "true");
  await expect(page.locator(".catalog-map-cluster.is-selected")).toBeVisible();
  for (const cluster of await page.locator(".catalog-map-cluster").all()) {
    await expect(cluster).toHaveCSS("border-top-color", "rgb(255, 255, 255)");
  }
  const missing = fixtures[11];
  const missingRow = page.locator(`[data-testid="catalog-map-item"][data-property-id="${missing.id}"]`);
  await missingRow.getByTestId("catalog-map-toggle").click();
  await expect(missingRow).toContainText("Местоположение уточняется");
  await expect(page.locator(`.catalog-map-pin[data-property-id="${missing.id}"]`)).toHaveCount(0);
});

test("property type tabs filter both map and list", async ({ page }) => {
  await page.goto(`/catalog?view=map&location=${encodeURIComponent(location)}#homes`);
  await expect(page.locator('.catalog-type-links button')).toHaveText(['Жилые комплексы', 'Квартиры']);
  await expect(page.getByRole('button', { name: 'Жилые комплексы', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expectListedIds(page, fixtures.filter((item) => !item.elite && item.type === 'complex').map((item) => item.id));
  for (const [type, label] of [["apartment", "Квартиры"], ["complex", "Жилые комплексы"]]) {
    const loading = mapResponse(page, (query) => query.get("type") === type);
    await page.getByRole("group", { name: "Тип недвижимости", exact: true }).getByRole("button", { name: label, exact: true }).click();
    const response = await loading;
    expect(response.ok()).toBe(true);
    const data = await response.json();
    const ids = fixtures.filter((item) => !item.elite && item.type === type).map((item) => item.id);
    expect(data.items.map((item: { id: string }) => item.id).sort()).toEqual([...ids].sort());
    await expectListedIds(page, ids);
    await expect(page.locator(".catalog-map-pin")).toHaveCount(ids.length);
    expect(new URL(page.url()).searchParams.get("view")).toBe("map");
    await page.getByRole('button', { name: 'Карточки', exact: true }).click();
    await expect(page.locator('.catalog-grid .property-card')).toHaveCount(ids.length);
    const slugs = data.items.map((item: { slug: string }) => '/catalog/' + item.slug);
    expect(await page.locator('.catalog-grid .property-card').evaluateAll(cards => cards.map(card => card.getAttribute('href')))).toEqual(slugs);
    await page.getByRole('button', { name: 'Карта', exact: true }).click();
    await expectListedIds(page, ids);
  }
});

test("catalog title search persists through sorting, map mode, and other filters", async ({ page }) => {
  await page.goto(`/catalog?location=${encodeURIComponent(location)}#homes`);
  await expect(page.locator(".property-card")).toHaveCount(3);
  const title = "Проверка карты 16";
  await page.getByTestId("catalog-title-search-input").fill(title);
  const searching = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/properties" && url.searchParams.get("q") === title;
  });
  await page.getByTestId("catalog-title-search-submit").click();
  const searched = await searching;
  expect(searched.ok()).toBe(true);
  expect((await searched.json()).items.map((item: { id: string }) => item.id)).toEqual([fixtures[15].id]);
  await expect(page.locator(".property-card")).toHaveCount(1);
  expect(new URL(page.url()).searchParams.get("q")).toBe(title);
  expect(new URL(page.url()).searchParams.get("location")).toBe(location);

  await page.getByRole("combobox", { name: "Сортировка" }).click();
  await page.getByRole("option", { name: "Сначала дороже", exact: true }).click();
  await expect(page).toHaveURL(/sort=price_desc/);
  expect(new URL(page.url()).searchParams.get("q")).toBe(title);
  const mapping = mapResponse(page, (query) => query.get("q") === title);
  await page.getByRole("button", { name: "Карта", exact: true }).click();
  expect((await mapping).ok()).toBe(true);
  await expectListedIds(page, [fixtures[15].id]);

  await page.getByRole("button", { name: "Фильтры", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("spinbutton", { name: "Цена от", exact: true }).fill("25000000");
  const filtering = mapResponse(page, (query) => query.get("minPrice") === "25000000");
  await dialog.getByRole("button", { name: "Показать объекты", exact: true }).click();
  const filtered = await filtering;
  expect(new URL(filtered.url()).searchParams.get("q")).toBe(title);
  await expectListedIds(page, [fixtures[15].id]);

  const clearing = mapResponse(page, (query) => !query.has("q"));
  await page.getByTestId("catalog-title-search-clear").click();
  const cleared = await clearing;
  const query = new URL(cleared.url()).searchParams;
  expect(query.get("minPrice")).toBe("25000000");
  expect(query.get("location")).toBe(location);
  expect(query.get("sort")).toBe("price_desc");
  expect(new URL(page.url()).searchParams.get("view")).toBe("map");
  await expectListedIds(page, [fixtures[15].id, fixtures[16].id]);
  await expect(page.getByTestId("catalog-title-search-input")).toHaveValue("");
});

test("full-width title search sits below the heading and the view indicator slides between equal buttons", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(`/catalog?location=${encodeURIComponent(location)}#homes`);
  const heading = page.locator(".catalog-heading");
  const search = page.getByTestId("catalog-title-search");
  const view = page.getByRole("group", { name: "Вид каталога", exact: true });
  await expect(page.locator(".property-card")).toHaveCount(3);
  await expect(heading.getByTestId("catalog-title-search")).toHaveCount(0);
  const shellBox = (await page.locator("#homes > .shell").boundingBox())!;
  const headingBox = (await heading.boundingBox())!;
  const searchBox = (await search.boundingBox())!;
  const viewBox = (await view.boundingBox())!;
  const switchRadius = await view.evaluate((element) => getComputedStyle(element).borderRadius);
  await expect(search).toHaveCSS("border-radius", switchRadius);
  expect(Math.abs(searchBox.x - shellBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(searchBox.width - shellBox.width)).toBeLessThanOrEqual(1);
  expect(searchBox.y).toBeGreaterThanOrEqual(headingBox.y + headingBox.height - 1);
  expect(Math.abs(viewBox.x + viewBox.width - headingBox.x - headingBox.width)).toBeLessThanOrEqual(1);
  expect(viewBox.y).toBeGreaterThanOrEqual(headingBox.y);
  const cards = (await view.getByRole("button", { name: "Карточки", exact: true }).boundingBox())!;
  const map = (await view.getByRole("button", { name: "Карта", exact: true }).boundingBox())!;
  expect(Math.abs(cards.width - map.width)).toBeLessThanOrEqual(1);

  const indicator = page.getByTestId("catalog-view-indicator");
  await expect(indicator).toBeVisible();
  const samples = await view.evaluate(async (element) => {
    const marker = element.querySelector('[data-testid="catalog-view-indicator"]')!;
    const positions = [marker.getBoundingClientRect().x];
    const start = performance.now();
    (Array.from(element.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Карта") as HTMLButtonElement).click();
    await new Promise<void>((resolve) => {
      const sample = () => {
        positions.push(marker.getBoundingClientRect().x);
        if (performance.now() - start >= 600) resolve();
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    return positions;
  });
  await expect(view.getByRole("button", { name: "Карта", exact: true })).toHaveAttribute("aria-pressed", "true");
  const first = samples[0];
  const last = samples[samples.length - 1];
  expect(last - first).toBeGreaterThan(cards.width * 0.9);
  expect(samples.some((position) => position > first + 1 && position < last - 1), "The highlight should move through intermediate positions").toBe(true);
  const indicatorBox = (await indicator.boundingBox())!;
  expect(Math.abs(indicatorBox.x + indicatorBox.width / 2 - map.x - map.width / 2)).toBeLessThanOrEqual(2);
});

test("switching catalog views keeps the page and heading still through delayed data", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(`/catalog?location=${encodeURIComponent(location)}#homes`);
  await expect(page.locator(".property-card")).toHaveCount(3);
  const delayed: string[] = [];
  await page.route("**/api/properties**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path !== "/api/properties" && path !== "/api/properties/map") return route.continue();
    const response = await route.fetch();
    delayed.push(path);
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.fulfill({ response });
  });
  await page.evaluate(async () => {
    window.scrollBy({ top: -80, behavior: "instant" });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const heading = page.locator(".catalog-heading");
  for (const label of ["Карта", "Карточки"]) {
    const recording = heading.evaluate((element) => new Promise<{ scroll: number; top: number }[]>((resolve) => {
      const samples: { scroll: number; top: number }[] = [];
      const start = performance.now();
      const sample = () => {
        samples.push({ scroll: window.scrollY, top: element.getBoundingClientRect().top });
        if (performance.now() - start >= 1400) resolve(samples);
        else requestAnimationFrame(sample);
      };
      sample();
    }));
    await page.getByRole("button", { name: label, exact: true }).click();
    if (label === "Карта") await expect(page.getByTestId("catalog-map")).toBeVisible();
    else await expect(page.locator(".catalog-grid .property-card")).toHaveCount(3);
    const samples = await recording;
    const before = samples[0];
    expect(Math.max(...samples.map((sample) => Math.abs(sample.scroll - before.scroll))), `${label}: page scroll must stay stable while the response is pending`).toBeLessThanOrEqual(1);
    expect(Math.max(...samples.map((sample) => Math.abs(sample.top - before.top))), `${label}: heading must not jump during the view switch`).toBeLessThanOrEqual(1);
    expect(new URL(page.url()).hash).toBe("#homes");
  }
  expect(delayed).toContain("/api/properties/map");
});

test("a non-first map card morphs smoothly in place", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(`/catalog?view=map&location=${encodeURIComponent(location)}#homes`);
  const id = fixtures[14].id;
  const row = page.locator(`[data-testid="catalog-map-item"][data-property-id="${id}"]`);
  const card = row.locator(".property-card");
  await expect(page.getByTestId("catalog-map-item").first()).not.toHaveAttribute("data-property-id", id);
  await expect(row).toHaveAttribute("data-expanded", "false");
  const order = await listedOrder(page);
  const original = (await card.elementHandle())!;
  const collapsedHeight = (await card.boundingBox())!.height;
  // Start measuring before the click so an immediate height jump cannot escape the check.
  const recording = card.evaluate((element) => new Promise<number[]>((resolve) => {
    const heights: number[] = [];
    const start = performance.now();
    let expandedAt: number | undefined;
    const sample = () => {
      const now = performance.now();
      heights.push(element.getBoundingClientRect().height);
      if (element.closest('[data-testid="catalog-map-item"]')?.getAttribute("data-expanded") === "true") expandedAt ??= now;
      if ((expandedAt !== undefined && now - expandedAt >= 650) || now - start >= 5000) resolve(heights);
      else requestAnimationFrame(sample);
    };
    sample();
  }));
  await row.getByTestId("catalog-map-toggle").click();
  const heights = await recording;
  expect(await listedOrder(page)).toEqual(order);
  await expect(row).toHaveAttribute("data-expanded", "true");
  expect(await card.evaluate((element, previous) => element === previous, original)).toBe(true);
  const expandedHeight = (await card.boundingBox())!.height;
  expect(expandedHeight).toBeGreaterThan(collapsedHeight + 100);
  expect(heights.some((height) => height > collapsedHeight + 2 && height < expandedHeight - 2), "The same card must pass through intermediate heights while expanding").toBe(true);
  await expect(row.locator("h3")).toHaveCount(1);
  await expect(row.locator(".card-price")).toHaveCount(1);
});

for (const reducedMotion of ["reduce", "no-preference"] as const) {
  test(`an offscreen card expands in place and scrolls only enough to be visible (${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await page.route("**/api/map/search?**", (route) => route.fulfill({
      json: { items: [{ id: "scroll-target", label: "Адрес проверочной квартиры", latitude: 54.65, longitude: 20.35 }] },
    }));
    await page.goto(`/elite?view=map&location=${encodeURIComponent(location)}#homes`);
    await expectListedIds(page, fixtures.filter((item) => item.elite).map((item) => item.id));
    const order = await listedOrder(page);
    const id = fixtures[0].id;
    const row = page.locator(`[data-testid="catalog-map-item"][data-property-id="${id}"]`);
    const card = row.locator(".property-card");
    const collapsedHeight = (await card.boundingBox())!.height;
    const results = page.getByTestId("catalog-map-results");
    expect(await results.evaluate((element) => element.scrollTop)).toBe(0);
    const listBox = (await results.boundingBox())!;
    expect((await row.boundingBox())!.y).toBeGreaterThan(listBox.y + listBox.height);

    await page.getByTestId("catalog-map-search-input").fill("Адрес проверочной квартиры");
    await page.getByTestId("catalog-map-search-submit").click();
    await page.getByTestId("catalog-map-search-result").click();
    await page.getByTestId("catalog-map-search-clear").click();
    expect(await listedOrder(page)).toEqual(order);
    const pin = page.locator(`.catalog-map-pin[data-property-id="${id}"]`);
    await expect(pin).toBeVisible();
    await pin.locator(".catalog-map-pin-body").click();
    await expect(row).toHaveAttribute("data-expanded", "true");
    await expect(row).toHaveAttribute("data-selected", "true");
    await expect.poll(async () => (await card.boundingBox())!.height).toBeGreaterThan(collapsedHeight + 100);
    await expect.poll(() => card.evaluate((element) => element.getAnimations().every((animation) => animation.playState !== "running"))).toBe(true);
    const viewportState = () => row.evaluate((element) => {
      const list = element.closest('[data-testid="catalog-map-results"]') as HTMLElement;
      const card = element.getBoundingClientRect();
      const viewport = list.getBoundingClientRect();
      return {
        clipped: Math.max(0, viewport.top - card.top, card.bottom - viewport.bottom),
        scroll: list.scrollTop,
        minimumScroll: Math.max(0, card.bottom - viewport.top + list.scrollTop - list.clientHeight),
      };
    });
    await expect.poll(async () => (await viewportState()).clipped).toBeLessThanOrEqual(1);
    const visible = await viewportState();
    expect(visible.scroll).toBeGreaterThan(0);
    expect(Math.abs(visible.scroll - visible.minimumScroll), "Reveal only the clipped part of the expanded card").toBeLessThanOrEqual(2);
    expect(await listedOrder(page)).toEqual(order);

    await pin.locator(".catalog-map-pin-body").click();
    // Re-selecting a fully visible expanded card must not start another smooth scroll.
    await page.waitForTimeout(250);
    expect(await results.evaluate((element) => element.scrollTop)).toBe(visible.scroll);
    expect(await listedOrder(page)).toEqual(order);
  });
}

for (const elite of [false, true]) {
  test(`${elite ? "elite" : "ordinary"} filters and reset apply to map and list without changing mode`, async ({ page, request }) => {
    const path = elite ? "/elite" : "/catalog";
    await page.goto(`${path}?view=map&location=${encodeURIComponent(location)}#homes`);
    await expect(page.getByTestId("catalog-map")).toBeVisible();
    await page.getByRole("button", { name: "Фильтры", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("spinbutton", { name: "Цена от", exact: true }).fill(elite ? "20000000" : "25000000");
    const filtered = mapResponse(page, (query) => query.has("minPrice"));
    await dialog.getByRole("button", { name: "Показать объекты", exact: true }).click();
    const response = await filtered;
    expect(new URL(response.url()).searchParams.get("elite")).toBe(String(elite));
    const filteredData = await response.json();
    const expected = fixtures.filter((item) => item.elite === elite && item.type === (elite ? 'apartment' : 'complex') && item.price >= (elite ? 20000000 : 25000000));
    await expectListedIds(page, expected.map((item) => item.id));
    expect(filteredData.items.map((item: { id: string }) => item.id).sort()).toEqual(expected.map((item) => item.id).sort());
    expect(new URL(page.url()).searchParams.get("view")).toBe("map");

    await page.getByRole("button", { name: "Фильтры", exact: true }).click();
    const resetting = mapResponse(page, (query) => !query.has("minPrice") && !query.has("location"));
    await dialog.getByRole("button", { name: "Сбросить фильтры", exact: true }).click();
    const reset = await resetting;
    expect(new URL(reset.url()).searchParams.get("elite")).toBe(String(elite));
    expect(new URL(reset.url()).searchParams.get("type")).toBe(elite ? "apartment" : 'complex');
    const all = await (await request.get(`/api/properties/map?elite=${elite}&type=${elite ? 'apartment' : 'complex'}`)).json();
    await expectListedIds(page, all.items.map((item: { id: string }) => item.id));
    await expect(page).toHaveURL(new RegExp(`${path}\\?view=map#homes$`));
  });
}

test("objects at the same address can each be selected from the list", async ({ page }) => {
  await page.goto(`/elite?view=map&location=${encodeURIComponent(location)}#homes`);
  await expectListedIds(page, fixtures.filter((item) => item.elite).map((item) => item.id));
  const order = await listedOrder(page);
  for (const item of [fixtures[12], fixtures[13]]) {
    const row = page.locator(`[data-testid="catalog-map-item"][data-property-id="${item.id}"]`);
    await row.getByTestId("catalog-map-toggle").click();
    await expect(row).toHaveAttribute("data-selected", "true");
    expect(await listedOrder(page)).toEqual(order);
    const pin = page.locator(`.catalog-map-pin[data-property-id="${item.id}"]`);
    await expect(pin).toBeVisible();
    await expect(pin).toHaveClass(/is-selected/);
  }
});

test("mobile map and result list fit the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/catalog?view=map&location=${encodeURIComponent(location)}#homes`);
  const canvas = page.getByTestId("catalog-map-canvas");
  const results = page.getByTestId("catalog-map-results");
  await expect(canvas).toBeVisible();
  await expect(results).toBeVisible();
  await expectListedIds(page, fixtures.filter((item) => !item.elite && item.type === 'complex').map((item) => item.id));
  const mapBox = (await canvas.boundingBox())!;
  const listBox = (await results.boundingBox())!;
  expect(listBox.y).toBeGreaterThanOrEqual(mapBox.y + mapBox.height - 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("mouse wheel zooms the map", async ({ page }) => {
  await page.goto(`/catalog?view=map&location=${encodeURIComponent(location)}#homes`);
  const canvas = page.getByTestId("catalog-map-canvas");
  await expect(page.locator(".leaflet-tile-loaded").first()).toBeVisible();
  const before = await maxTileZoom(page);
  await canvas.hover();
  await page.mouse.wheel(0, -500);
  await expect.poll(() => maxTileZoom(page)).toBeGreaterThan(before);
});

test("selection keeps zoom and pans only when a visible pin is outside the central safe area", async ({ page }) => {
  await page.goto(`/catalog?view=map&location=${encodeURIComponent(location)}#homes`);
  await expect(page.locator(".catalog-map-pin")).toHaveCount(3);
  await expect(page.locator(".leaflet-tile-loaded").first()).toBeVisible();
  const anchor = (id: string) => page.locator(`.catalog-map-pin[data-property-id="${id}"]`).evaluate((element) => {
    const icon = element.getBoundingClientRect();
    const map = element.closest(".leaflet-container")!.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      x: icon.x - map.x - Number.parseFloat(style.marginLeft),
      y: icon.y - map.y - Number.parseFloat(style.marginTop),
      width: map.width,
      height: map.height,
    };
  });
  const middle = fixtures[15].id;
  const before = await anchor(middle);
  const zoom = await maxTileZoom(page);
  const safeHalf = Math.min(before.width, before.height) * 0.2;
  expect(Math.abs(before.x - before.width / 2)).toBeLessThan(safeHalf);
  expect(Math.abs(before.y - before.height / 2)).toBeLessThan(safeHalf);
  await page.locator(`[data-testid="catalog-map-item"][data-property-id="${middle}"]`).getByTestId("catalog-map-toggle").click();
  await expect(page.locator(`[data-testid="catalog-map-item"][data-property-id="${middle}"]`)).toHaveAttribute("data-expanded", "true");
  expect(await anchor(middle)).toEqual(before);
  expect(await maxTileZoom(page)).toBe(zoom);

  const edge = fixtures[14].id;
  const outside = await anchor(edge);
  expect(Math.max(Math.abs(outside.x - outside.width / 2), Math.abs(outside.y - outside.height / 2))).toBeGreaterThan(safeHalf);
  await page.locator(`[data-testid="catalog-map-item"][data-property-id="${edge}"]`).getByTestId("catalog-map-toggle").click();
  await expect.poll(async () => {
    const point = await anchor(edge);
    return Math.max(Math.abs(point.x - point.width / 2), Math.abs(point.y - point.height / 2));
  }).toBeLessThanOrEqual(2);
  expect(await maxTileZoom(page)).toBe(zoom);
});

test("address search submits explicitly and orders filtered objects by distance", async ({ page }) => {
  const queries: string[] = [];
  await page.route("**/api/map/search?**", (route) => {
    queries.push(new URL(route.request().url()).searchParams.get("q") || "");
    return route.fulfill({
      json: { items: [{ id: "baltiysk-test", label: "Морской бульвар, Балтийск", latitude: 54.6519, longitude: 19.9041, bounds: [54.650, 19.901, 54.654, 19.908] }] },
    });
  });
  await page.goto(`/catalog?view=map&location=${encodeURIComponent(location)}#homes`);
  const ids = fixtures.filter((item) => !item.elite && item.type === 'complex').map((item) => item.id);
  await expectListedIds(page, ids);
  const orderBefore = await listedOrder(page);
  const selectedBefore = await page.locator('[data-testid="catalog-map-item"][data-selected="true"]').getAttribute("data-property-id");
  const input = page.getByTestId("catalog-map-search-input");
  await input.fill("Балтийск, Морской бульвар");
  // Wait beyond a normal autocomplete debounce to prove typing alone does not search.
  await page.waitForTimeout(700);
  expect(queries).toEqual([]);
  await page.getByTestId("catalog-map-search-submit").click();
  await expect(page.getByTestId("catalog-map-search-result")).toHaveCount(1);
  expect(queries).toEqual(["Балтийск, Морской бульвар"]);
  await page.getByTestId("catalog-map-search-result").click();
  await expect(page.locator(".catalog-map-search-pin")).toBeVisible();
  await expect.poll(() => page.locator(".leaflet-tile-loaded").evaluateAll((images) => images.some((image) => {
    const [zoom, x, y] = new URL((image as HTMLImageElement).src).pathname.slice(1).split("/").map((part) => Number.parseInt(part, 10));
    const scale = 2 ** zoom;
    const latitude = 54.6519 * Math.PI / 180;
    return x === Math.floor((19.9041 + 180) / 360 * scale)
      && y === Math.floor((1 - Math.asinh(Math.tan(latitude)) / Math.PI) / 2 * scale);
  }))).toBe(true);
  await expectListedIds(page, ids);
  await expect(page.locator('[data-testid="catalog-map-item"][data-selected="true"]')).toHaveAttribute("data-property-id", selectedBefore!);
  const nearest = [fixtures[14].id, fixtures[15].id, fixtures[16].id];
  expect(await listedOrder(page)).toEqual(nearest);
  expect(nearest).not.toEqual(orderBefore);
  await page.locator(`[data-testid="catalog-map-item"][data-property-id="${fixtures[15].id}"]`).getByTestId("catalog-map-toggle").click();
  await expect(page.locator('[data-testid="catalog-map-item"][data-selected="true"]')).toHaveAttribute("data-property-id", fixtures[15].id);
  expect(await listedOrder(page)).toEqual(nearest);

  await page.getByRole("button", { name: "Фильтры", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("spinbutton", { name: "Цена от", exact: true }).fill("25000000");
  const filtering = mapResponse(page, (query) => query.get("minPrice") === "25000000");
  await dialog.getByRole("button", { name: "Показать объекты", exact: true }).click();
  expect((await filtering).ok()).toBe(true);
  await expectListedIds(page, [fixtures[15].id, fixtures[16].id]);
  expect(await listedOrder(page)).toEqual([fixtures[15].id, fixtures[16].id]);

  await page.getByTestId("catalog-map-search-clear").click();
  await expect(input).toHaveValue("");
  await expect(page.getByTestId("catalog-map-search-result")).toHaveCount(0);
  await expect(page.locator(".catalog-map-search-pin")).toHaveCount(0);
  await expectListedIds(page, [fixtures[15].id, fixtures[16].id]);
  const defaultFilteredOrder = orderBefore.filter((id) => id !== fixtures[14].id);
  expect(await listedOrder(page)).toEqual(defaultFilteredOrder);
  expect(new URL(page.url()).searchParams.get("location")).toBe(location);
  expect(new URL(page.url()).searchParams.get("minPrice")).toBe("25000000");

  await input.fill("Балтийск, Морской бульвар");
  await page.getByTestId("catalog-map-search-submit").click();
  await page.getByTestId("catalog-map-search-result").click();
  expect(await listedOrder(page)).toEqual([fixtures[15].id, fixtures[16].id]);
  await input.fill("Следующий адрес");
  await expect.poll(() => listedOrder(page)).toEqual(defaultFilteredOrder);
  await expect(page.locator(".catalog-map-search-pin")).toHaveCount(0);
  expect(queries).toHaveLength(2);
});

test("distance sorting keeps equal coordinates stable and unknown coordinates last", async ({ page }) => {
  await page.route("**/api/map/search?**", (route) => route.fulfill({
    json: { items: [{ id: "equal-distance", label: "Адрес двух квартир", latitude: 54.71, longitude: 20.52 }] },
  }));
  await page.goto(`/elite?view=map&location=${encodeURIComponent(location)}#homes`);
  await expectListedIds(page, fixtures.filter((item) => item.elite).map((item) => item.id));
  const order = await listedOrder(page);
  await page.getByTestId("catalog-map-search-input").fill("Адрес двух квартир");
  await page.getByTestId("catalog-map-search-submit").click();
  await page.getByTestId("catalog-map-search-result").click();
  const sorted = await listedOrder(page);
  expect(sorted.slice(0, 2)).toEqual(order.filter((id) => id === fixtures[12].id || id === fixtures[13].id));
  expect(sorted[sorted.length - 1]).toBe(fixtures[11].id);
  await page.locator(`[data-testid="catalog-map-item"][data-property-id="${fixtures[12].id}"]`).getByTestId("catalog-map-toggle").click();
  await expect(page.locator('[data-testid="catalog-map-item"][data-selected="true"]')).toHaveAttribute("data-property-id", fixtures[12].id);
  expect(await listedOrder(page)).toEqual(sorted);
  await page.getByTestId("catalog-map-search-clear").click();
  expect(await listedOrder(page)).toEqual(order);
});

test("address search handles unavailable service and empty results", async ({ page }) => {
  let fail = true;
  await page.route("**/api/map/search?**", (route) => route.fulfill(fail
    ? { status: 503, json: { statusMessage: "Address search is temporarily unavailable" } }
    : { json: { items: [] } }));
  await page.goto(`/catalog?view=map&location=${encodeURIComponent(location)}#homes`);
  const input = page.getByTestId("catalog-map-search-input");
  await input.fill("Неизвестный адрес");
  await input.press("Enter");
  await expect(page.getByTestId("catalog-map-search-status")).toContainText(/не удалось|недоступ|ошибка|попробуйте/i);
  await expect(page.getByTestId("catalog-map-search-submit")).toBeEnabled();
  fail = false;
  await page.getByTestId("catalog-map-search-submit").click();
  await expect(page.getByTestId("catalog-map-search-status")).toContainText(/не найден|не нашли/i);
  await expect(page.getByTestId("catalog-map-search-result")).toHaveCount(0);
  await expectListedIds(page, fixtures.filter((item) => !item.elite && item.type === 'complex').map((item) => item.id));
  await page.getByTestId("catalog-map-search-clear").click();
  await expect(input).toHaveValue("");
  await expect(page.getByTestId("catalog-map-search-status")).toHaveCount(0);
});
