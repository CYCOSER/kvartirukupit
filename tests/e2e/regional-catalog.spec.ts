import { test, expect } from "@playwright/test";
import type { Property } from "../../shared/property";

const startingPrices: Record<string, number> = {
  "zhk-adres-schastya": 9460000,
  "zhk-ratskhof-dom": 5764000,
  "zhk-tikhiy-dom": 7900000,
};

test("NMarket catalog contains the three imported Kaliningrad projects with source photos", async ({
  page,
  request,
}) => {
  const response = await request.get("/api/properties", {
    params: { location: "Калининград", type: "complex" },
  });
  expect(response.ok()).toBe(true);
  const { items, locations } = (await response.json()) as {
    items: Property[];
    locations: string[];
  };
  expect(locations).toContain("Калининград");
  const imported = items.filter((item) => item.sourceId !== null);
  expect(imported.map((item) => item.slug).sort()).toEqual([
    "zhk-adres-schastya",
    "zhk-ratskhof-dom",
    "zhk-tikhiy-dom",
  ]);
  for (const property of imported) {
    expect(property.location).toBe("Калининград");
    expect(property.address).toContain("Калининград");
    expect(property.sourceUrl).toBe("https://klg.nmarket.pro/novostroyki");
    expect(property.sourceName).toBe("НМаркет.ПРО");
    expect(property.sourceMode).toBe("curated");
    expect(property.sourceId).toBe("curated:" + property.slug);
    expect(Number.isFinite(Date.parse(property.sourceFetchedAt!))).toBe(true);
    expect(property.demo).toBe(false);
    expect(property.landArea).toBeNull();
    expect(property.seaDistance).toBeNull();
    expect(property.sourceNote).toBeTruthy();
    expect(property.area).toBeNull();
    expect(property.bedrooms).toBeNull();
    expect(property.priceKind).toBe("from");
    expect(property.price).toBe(startingPrices[property.slug]);
    expect(property.priceArea).toBeNull();
    expect(property.description).not.toMatch(
      /НМаркет|nmarket|Примеры квартир|https?:\/\//i,
    );
    expect(property.images.length).toBeGreaterThan(0);
    for (const image of property.images) {
      expect(
        image.file.startsWith("/images/projects/" + property.slug + "/"),
      ).toBe(true);
      expect(image.alt).not.toMatch(/НМаркет|nmarket/i);
    }
  }
  const property = imported.find((item) => item.price === null) || imported[0]!;
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/catalog/" + property.slug);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    property.title,
  );
  await expect(page.locator(".detail-source")).toHaveCount(0);
  if (property.price === null)
    await expect(page.locator(".detail-hero-price")).toContainText(
      /уточняется|по запросу/i,
    );
  if (!property.images.length) {
    await expect(page.locator(".gallery-empty")).toContainText(
      "Фотографии пока не добавлены",
    );
    await expect(page.locator(".gallery-main")).toHaveCount(0);
  }
  await expect(page.locator(".detail-gallery-place")).not.toContainText(
    "до моря",
  );
  await expect(page.locator(".detail-hero .scene-aside")).toContainText(
    "Квартиры от",
  );
  const structuredData = await page
    .locator('script[type="application/ld+json"]')
    .allTextContents();
  expect(
    structuredData.some((text) => text.includes('"price":' + property.price)),
  ).toBe(true);
});
