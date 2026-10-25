import test from "node:test";
import assert from "node:assert/strict";
import { propertySchema } from "../shared/property";
import { propertyQuery, propertyQuerySchema } from "../server/utils/property-query";

const apartment = {
  title: "Квартира для проверки", slug: "map-test", type: "apartment",
  location: "Калининград", address: "Тестовый адрес", price: 15000000,
  status: "available", area: 80, landArea: null, bedrooms: 2, floors: 5,
  readiness: "Готов", finish: "Чистовая", description: "", utilities: [],
  published: true, featured: false, elite: false, demo: false,
};

test("coordinates require a finite pair within geographic bounds, or two empty fields", () => {
  const missing = propertySchema.parse(apartment);
  assert.equal(missing.latitude, null);
  assert.equal(missing.longitude, null);
  for (const [latitude, longitude] of [[null, null], [0, 0], [90, 180], [-90, -180], [54.71, 20.45]])
    assert.equal(propertySchema.safeParse({ ...apartment, latitude, longitude }).success, true);
  for (const [latitude, longitude] of [[null, 20], [54, null], [91, 20], [54, -181], [NaN, 20], [Infinity, 20], [54, "20"]])
    assert.equal(propertySchema.safeParse({ ...apartment, latitude, longitude }).success, false);
});

test("catalog query keeps map and grid filters identical and enforces elite apartment scope", () => {
  const filters = { type: "complex", elite: "true", status: "all", location: "Калининград", minPrice: "100", maxPrice: "900", minArea: "20", maxArea: "120", bedrooms: "2", sort: "price_asc", view: "map", page: "99" };
  const query = propertyQuery(propertyQuerySchema.parse(filters));
  assert.deepEqual(query.where, {
    published: true, type: "apartment", elite: true,
    location: "Калининград", price: { gte: 100, lte: 900 },
    area: { gte: 20, lte: 120 }, bedrooms: { gte: 2 },
  });
  assert.deepEqual(query.orderBy, [{ price: { sort: "asc", nulls: "last" } }, { id: "asc" }]);
  const ordinary = propertyQuery(propertyQuerySchema.parse({ type: "complex", view: "map" }));
  assert.deepEqual(ordinary.where, { published: true, status: "available", type: "complex", elite: false });
  assert.equal(propertyQuerySchema.safeParse({ bedrooms: "-1" }).success, false);
  assert.equal(propertyQuerySchema.safeParse({ elite: "invalid" }).success, false);
});

test("catalog title search trims, rejects controls, and escapes LIKE patterns without changing the catalog scope", () => {
  for (const q of [undefined, "", "  "]) {
    const result = propertyQuery(propertyQuerySchema.parse({ q }));
    assert.equal(result.where.title, undefined);
  }
  const result = propertyQuery(propertyQuerySchema.parse({ q: "  Дом 100%_\\  ", elite: "true", type: "complex", minPrice: "100" }));
  assert.deepEqual(result.where, {
    published: true, status: "available", type: "apartment", elite: true,
    title: { contains: "Дом 100\\%\\_\\\\", mode: "insensitive" },
    price: { gte: 100, lte: undefined },
  });
  for (const q of ["x".repeat(201), "дом\n", "\tдом", "дом\u007f", ["дом"]])
    assert.equal(propertyQuerySchema.safeParse({ q }).success, false);
});
