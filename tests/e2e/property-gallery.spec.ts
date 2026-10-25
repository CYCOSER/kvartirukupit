import { test, expect, type Page } from "@playwright/test";
import type { Property } from "../../shared/property";

async function openGalleryFixture(
  page: Page,
  photoCount = 3,
  values: Partial<Property> = {},
) {
  const catalog = await page.request.get("/api/properties");
  expect(catalog.ok()).toBe(true);
  const { items } = await catalog.json();
  expect(items.length).toBeGreaterThan(0);
  const property = items[0] as Property;
  const photos = [
    { name: "baltic-coast", width: 1200, height: 800 },
    { name: "baltic-terrace", width: 600, height: 900 },
    { name: "journal-morning", width: 1000, height: 1000 },
    { name: "panorama", width: 1800, height: 600 },
  ];
  await page.unroute("**/gallery-fixture/*");
  await page.route("**/gallery-fixture/*", async (route) => {
    const photo = photos.find(({ name }) => route.request().url().includes(name))!;
    await route.fulfill({
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="${photo.width}" height="${photo.height}"><rect width="100%" height="100%" fill="#abc"/></svg>`,
    });
  });
  await page.unroute("**/api/properties/*");
  await page.route(`**/api/properties/${property.slug}`, async (route) => {
    await route.fulfill({
      json: {
        ...property,
        ...values,
        images: values.images ?? photos
          .slice(0, photoCount)
          .map(({ name }, index) => ({
            id: `gallery-fixture-${index}`,
            file: `/gallery-fixture/${name}.svg`,
            alt: `Тестовое фото ${index + 1}`,
            order: index,
          })),
      },
    });
  });
  // Client navigation lets the browser fixture replace only the detail response.
  await page.goto("/catalog?type=" + property.type);
  await page.locator(`a[href="/catalog/${property.slug}"]`).first().click();
  await expect(page).toHaveURL(new RegExp(`/catalog/${property.slug}$`));
}

test("missing photos stay empty and example prices are not advertised as a minimum", async ({
  page,
}) => {
  await openGalleryFixture(page, 0, {
    area: null,
    landArea: null,
    bedrooms: null,
    floors: null,
    price: null,
    sourceMode: "curated",
    sourceUrl: "https://example.com/project",
    sourceNote: "Сведения проверены на сайте проекта. Наличие квартир уточняйте у застройщика.",
  });
  await expect(page.locator(".gallery-empty")).toHaveText(
    "Фотографии пока не добавлены",
  );
  await expect(page.locator(".detail-hero .scene-photo")).toHaveCount(0);
  await expect(page.locator(".gallery-main")).toHaveCount(0);
  await expect(page.locator(".detail-specs")).not.toContainText(
    "Площадь квартиры",
  );
  await expect(page.locator(".detail-hero-price")).toHaveText(
    "Цена по запросу",
  );
  await expect(page.locator(".detail-source")).toHaveCount(0);

  await openGalleryFixture(page, 0, {
    price: 6764000,
    priceKind: "example",
    priceArea: 38.6,
  });
  await expect(page.locator(".detail-hero .scene-aside")).toContainText(
    "Стоимость",
  );
  await expect(page.locator(".detail-hero .scene-aside")).not.toContainText(
    "Квартиры от",
  );
  const product = await page
    .locator('script[type="application/ld+json"]')
    .evaluateAll((scripts) =>
      scripts
        .map((script) => JSON.parse(script.textContent || "{}"))
        .find((value) => value["@type"] === "Product"),
    );
  expect(product).toBeTruthy();
  expect(product).not.toHaveProperty("offers");
});

test("floor plans and photographs remain fully visible in the gallery", async ({ page }) => {
  await openGalleryFixture(page, 2, {
    images: [
      { id: 'floor-plan', file: '/images/baltic-coast.webp', alt: 'Планировка', order: 0, kind: 'plan' },
      { id: 'photograph', file: '/images/baltic-terrace.webp', alt: 'Фотография', order: 1, kind: 'photo' },
    ],
  });
  await expect(page.locator('.gallery-main img.is-plan').first()).toHaveCSS('object-fit', 'contain');
  await expect(page.locator('.gallery-main img:not(.is-plan)').first()).toHaveCSS('object-fit', 'contain');
  await expect(page.locator('.gallery-thumbs img.is-plan')).toHaveCSS('object-fit', 'contain');
  await expect(page.locator('.detail-hero .scene-photo')).toHaveAttribute('src', '/images/baltic-terrace.webp');
  await expect(page.locator('.detail-hero .scene-photo')).toHaveCSS('object-fit', 'cover');
  await openGalleryFixture(page, 1, {
    images: [{ id: 'floor-plan-only', file: '/images/baltic-coast.webp', alt: 'Планировка', order: 0, kind: 'plan' }],
  });
  await expect(page.locator('.detail-hero .scene-photo')).toHaveCSS('object-fit', 'contain');
});

test("mixed photo ratios scroll manually, loop and use a shorter ribbon", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [1440, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await openGalleryFixture(page);
    const rail = page.locator(".gallery-rail");
    await rail.scrollIntoViewIfNeeded();
    await expect(page.locator(".detail-image-count")).toHaveText("01 / 03");
    await expect.poll(() => page.locator(".gallery-thumbs img").evaluateAll((images) =>
      images.every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0),
    )).toBe(true);
    await expect.poll(() => page.locator(".gallery-main").nth(3).evaluate((image) => {
      const rect = image.getBoundingClientRect();
      const rail = image.closest(".gallery-rail")!.getBoundingClientRect();
      return Math.abs(rect.left + rect.width / 2 - rail.left - rail.width / 2);
    })).toBeLessThan(1);
    const geometry = await page
      .locator(".gallery-main")
      .evaluateAll((images) => {
        const current = images[3].getBoundingClientRect();
        const previous = images[2].getBoundingClientRect();
        const next = images[4].getBoundingClientRect();
        const heading = document
          .querySelector(".detail-gallery-heading")!
          .getBoundingClientRect();
        const viewport = document.querySelector(".gallery-rail")!.getBoundingClientRect();
        return {
          width: current.width,
            height: current.height,
            expectedHeight: heading.width / (window.innerWidth > 540 ? 1.85 : 1.12) * .85,
            ratios: images.slice(3, 6).map((image) => {
              const rect = image.getBoundingClientRect();
              const img = image.querySelector("img")!;
              return { actual: rect.width / rect.height, natural: img.naturalWidth / img.naturalHeight, height: rect.height };
            }),
          center: (current.left + current.right) / 2,
          viewportCenter: (viewport.left + viewport.right) / 2,
          leftPeek: previous.right - viewport.left,
          rightPeek: viewport.right - next.left,
          gap: next.left - current.right,
          overflow:
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
        };
      });
    expect(geometry.height).toBeCloseTo(geometry.expectedHeight, 0);
    for (const photo of geometry.ratios) {
      expect(photo.actual).toBeCloseTo(photo.natural, 2);
      expect(photo.height).toBeCloseTo(geometry.height, 0);
    }
    expect(geometry.center).toBeCloseTo(geometry.viewportCenter, 0);
    if (width > 540) {
      expect(geometry.leftPeek).toBeGreaterThan(0);
      expect(geometry.rightPeek).toBeGreaterThan(0);
    }
    expect(Math.abs(geometry.leftPeek - geometry.rightPeek)).toBeLessThanOrEqual(1);
    expect(geometry.gap).toBe(12);
    expect(geometry.overflow).toBe(false);
    await page.locator(".gallery-carousel").scrollIntoViewIfNeeded();
    await page.locator(".gallery-carousel").hover();
    await page.screenshot({
      path: `test-results/property-gallery-${width}.png`,
    });
    await page
      .getByRole("button", { name: "Предыдущее фото", exact: true })
      .click();
    await expect(page.locator(".detail-image-count")).toHaveText("03 / 03");
    await page
      .getByRole("button", { name: "Следующее фото", exact: true })
      .click();
    await expect(page.locator(".detail-image-count")).toHaveText("01 / 03");
    await page
      .getByRole("button", { name: "Показать фото 2", exact: true })
      .click();
    await expect(page.locator(".detail-image-count")).toHaveText("02 / 03");
    await page.getByRole("button", { name: "Открыть фото 2 в увеличенном формате" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(".detail-image-count")).toHaveText("03 / 03");
    await expect(rail).toBeFocused();
    // Native scrolling (touch/trackpad) updates the counter and thumbnail too.
    await rail.evaluate((el) => {
      const photos = el.querySelectorAll(".gallery-main");
      const current = photos[5].getBoundingClientRect();
      const previous = photos[4].getBoundingClientRect();
      el.scrollBy({ left: previous.left + previous.width / 2 - current.left - current.width / 2, behavior: "instant" });
    });
    await expect(page.locator(".detail-image-count")).toHaveText("02 / 03");
    await expect(
      page.getByRole("button", { name: "Показать фото 2", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page
    .getByRole("button", { name: "Следующее фото", exact: true })
    .click();
  await expect(page.locator(".detail-image-count")).toHaveText("03 / 03");
  await page.waitForTimeout(5500);
  await expect(page.locator(".detail-image-count")).toHaveText("03 / 03");
  await openGalleryFixture(page, 1, {
    images: [{ id: "panorama", file: "/gallery-fixture/panorama.svg", alt: "Панорама", order: 0 }],
  });
  await expect(page.locator(".gallery-main")).toHaveCount(1);
  await expect(page.locator(".gallery-arrow")).toHaveCount(0);
  await expect(page.locator(".gallery-thumbs")).toHaveCount(0);
  const panorama = page.locator(".gallery-main");
  await panorama.scrollIntoViewIfNeeded();
  await expect(panorama).toHaveCSS("aspect-ratio", "3 / 1");
  await page.locator(".gallery-rail").evaluate((el) => el.scrollTo({ left: 0, behavior: "instant" }));
  expect((await panorama.boundingBox())!.x).toBeGreaterThanOrEqual(0);
});

test("server-rendered photos loaded before hydration keep their original ratios", async ({ page }) => {
  const catalog = await page.request.get("/api/properties");
  const { items } = await catalog.json();
  const property = items.find((item: Property) => item.images.length > 1) as Property;
  expect(property).toBeTruthy();
  const imagePaths = property.images.map((image) => new URL(image.file, "http://localhost").pathname);
  await page.route((url) => imagePaths.includes(url.pathname), (route) => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="100%" height="100%" fill="#abc"/></svg>',
  }));
  let hydrate!: () => void;
  const ready = new Promise<void>((resolve) => { hydrate = resolve; });
  await page.route("**/_nuxt/*.js", async (route) => {
    await ready;
    await route.continue();
  });
  await page.goto(`/catalog/${property.slug}`, { waitUntil: "commit" });
  try {
    await expect(page.locator(".gallery-thumbs img").first()).toHaveJSProperty("naturalWidth", 600);
  } finally {
    hydrate();
  }
  await expect(page.locator(".gallery-main").first()).toHaveCSS("aspect-ratio", "0.666667 / 1");
});

test("property photos open full-screen and close by button, Escape or backdrop", async ({
  page,
}) => {
  await openGalleryFixture(page);
  await expect(page.locator(".detail-image-count")).toHaveText("01 / 03");
  await page
    .getByRole("button", { name: "Открыть фото 1 в увеличенном формате" })
    .click();
  const lightbox = page.getByRole("dialog", {
    name: "Просмотр фотографий жилого комплекса",
  });
  await expect(lightbox).toBeVisible();
  await expect(lightbox.locator("img")).toHaveAttribute("src", /baltic-coast/);
  await lightbox
    .getByRole("button", { name: "Следующее увеличенное фото" })
    .click();
  await expect(lightbox.locator("img")).toHaveAttribute(
    "src",
    /baltic-terrace/,
  );
  await page.keyboard.press("ArrowLeft");
  await expect(lightbox.locator("img")).toHaveAttribute("src", /baltic-coast/);
  await page.keyboard.press("Escape");
  await expect(lightbox).not.toBeVisible();
  await expect(page.locator(".gallery-rail")).toBeFocused();

  await page
    .getByRole("button", { name: "Открыть фото 1 в увеличенном формате" })
    .click();
  await lightbox.getByRole("button", { name: "Закрыть фото" }).click();
  await expect(lightbox).not.toBeVisible();

  await page
    .getByRole("button", { name: "Открыть фото 1 в увеличенном формате" })
    .click();
  await lightbox.click({ position: { x: 5, y: 5 } });
  await expect(lightbox).not.toBeVisible();

  // A clickable side copy must not keep focus after the viewer closes.
  await page
    .locator(".gallery-main")
    .nth(2)
    .evaluate((button) => {
      (button as HTMLButtonElement).focus();
      (button as HTMLButtonElement).click();
    });
  await expect(lightbox).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".gallery-rail")).toBeFocused();
});
