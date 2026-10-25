import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import type { CatalogMapItem } from "../../shared/property";

test("map returns all filtered objects, keeps catalogs isolated, and hides unpublished listings", async ({ request }) => {
  test.setTimeout(90000);
  const env = { ...parseEnv(await readFile(".env", "utf8")), ...process.env };
  const headers = { Origin: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3100" };
  const login = await request.post("/api/admin/login", {
    headers, data: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
  });
  expect(login.ok()).toBeTruthy();
  const suffix = `${Date.now()}`;
  const location = `E2E карта ${suffix}`;
  const base = {
    title: "Проверочная квартира карты", type: "apartment", location, address: "Тестовый адрес",
    price: 10000000, status: "available", area: 70, landArea: null,
    bedrooms: 2, floors: 5, readiness: "Готов", finish: "Чистовая", seaDistance: null,
    description: "Временный объект проверки, удаляется после теста.", utilities: [],
    latitude: 54.71, longitude: 20.45,
    published: true, featured: false, elite: false, demo: true,
  };
  const ids: string[] = [];
  try {
    const invalid = await request.post("/api/admin/properties", {
      headers, data: { ...base, slug: `e2e-map-invalid-${suffix}`, longitude: null },
    });
    expect(invalid.status()).toBe(400);
    for (let index = 0; index < 16; index++) {
      const response = await request.post("/api/admin/properties", {
        headers, data: {
          ...base, slug: `e2e-map-${suffix}-${index}`, price: 10000000 + index,
          title: index === 0 ? `${base.title} 100%_\\` : index === 1 ? `${base.title} 100AB\\` : base.title,
          type: index === 0 ? "complex" : "apartment",
          elite: index === 13, published: index !== 14,
          status: index === 15 ? "sold" : "available",
          ...(index === 12 ? { latitude: null, longitude: null } : {}),
        },
      });
      expect(response.ok()).toBeTruthy();
      ids.push((await response.json()).id);
    }
    const query = new URLSearchParams({ location, sort: "price_asc" });
    const mapResponse = await request.get(`/api/properties/map?${query}`);
    expect(mapResponse.ok()).toBeTruthy();
    const map = await mapResponse.json() as { items: CatalogMapItem[]; total: number; pages: number };
    expect(map.total).toBe(13);
    expect(map.items.map((item) => item.id)).toEqual(ids.slice(0, 13));
    expect(map.items.at(-1)?.latitude).toBeNull();
    expect(map.items.every((item) => item.images.length <= 1)).toBeTruthy();
    expect(map.items[0]).not.toHaveProperty("description");
    expect(map.items[0]).not.toHaveProperty("sourceUrl");
    const grid = await (await request.get(`/api/properties?${query}`)).json();
    expect(grid.items).toHaveLength(12);
    expect(grid.total).toBe(map.total);
    const byTitle = new URLSearchParams({ location, sort: "price_asc", q: "  КВАРТИРА КАРТЫ  " });
    const titleMap = await (await request.get(`/api/properties/map?${byTitle}`)).json();
    const titleGrid = await (await request.get(`/api/properties?${byTitle}&page=2`)).json();
    expect(titleMap.items.map((item: CatalogMapItem) => item.id)).toEqual(ids.slice(0, 13));
    expect(titleGrid.total).toBe(13);
    expect(titleGrid.items.map((item: CatalogMapItem) => item.id)).toEqual([ids[12]]);
    const titleElite = await (await request.get(`/api/properties/map?${byTitle}&elite=true&type=complex`)).json();
    expect(titleElite.items.map((item: CatalogMapItem) => item.id)).toEqual([ids[13]]);
    const literalTitle = new URLSearchParams({ location, q: "100%_\\" });
    expect((await (await request.get(`/api/properties/map?${literalTitle}`)).json()).items.map((item: CatalogMapItem) => item.id)).toEqual([ids[0]]);
    const addressOnly = new URLSearchParams({ location, q: base.address });
    expect((await (await request.get(`/api/properties/map?${addressOnly}`)).json()).total).toBe(0);
    expect((await (await request.get(`/api/properties/map?${query}&page=99`)).json()).items).toHaveLength(13);
    const apartments = await (await request.get(`/api/properties/map?${query}&type=apartment`)).json();
    expect(apartments.items).toHaveLength(12);
    const elite = await (await request.get(`/api/properties/map?${query}&elite=true&type=complex`)).json();
    expect(elite.items.map((item: CatalogMapItem) => item.id)).toEqual([ids[13]]);
    const filtered = await (await request.get(`/api/properties/map?${query}&minPrice=10000011&maxPrice=10000012&minArea=60&maxArea=80&bedrooms=2`)).json();
    expect(filtered.items.map((item: CatalogMapItem) => item.id)).toEqual(ids.slice(11, 13));
    const all = await (await request.get(`/api/properties/map?${query}&status=all`)).json();
    expect(all.total).toBe(14);
    expect(all.items.some((item: CatalogMapItem) => item.id === ids[14])).toBeFalsy();
    expect((await request.get("/api/properties/map?minPrice=invalid")).status()).toBe(400);
  } finally {
    for (const id of ids) {
      const item = await (await request.get(`/api/admin/properties/${id}`)).json();
      expect(item.slug).toMatch(new RegExp(`^e2e-map-${suffix}-`));
      expect(item.sourceId).toBeNull();
      expect((await request.delete(`/api/admin/properties/${id}`, { headers })).ok()).toBeTruthy();
    }
  }
});
