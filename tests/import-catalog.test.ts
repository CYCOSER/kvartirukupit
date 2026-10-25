import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyImportFilters,
  filterImportObjects,
  importFilterError,
  type ImportObject,
} from "../shared/import-catalog";

const items: ImportObject[] = [
  {
    id: "1",
    title: "Квартира 1",
    category: "Квартиры",
    location: "Калининград",
    address: "Мира, 1",
    price: 5000000,
    area: 35,
    bedrooms: 0,
    floors: 8,
    developer: "Застройщик А",
    supported: true,
    existingId: null,
  },
  {
    id: "2",
    title: "Квартира 2",
    category: "Квартиры",
    location: "Калининград",
    address: "Мира, 1",
    price: 9000000,
    area: 65,
    bedrooms: 2,
    floors: 8,
    developer: "Застройщик Б",
    supported: true,
    existingId: "draft",
  },
  {
    id: "3",
    title: "Комплекс",
    category: "ЖК",
    location: "Зеленоградск",
    address: "",
    price: null,
    area: null,
    bedrooms: null,
    floors: null,
    developer: null,
    supported: false,
    existingId: null,
  },
];
const ids = (filters: Partial<ReturnType<typeof emptyImportFilters>>) =>
  filterImportObjects(items, { ...emptyImportFilters(), ...filters }).map(
    (item) => item.id,
  );

test("import filters combine inclusive numeric ranges and exclude unknown values only when bounded", () => {
  assert.deepEqual(
    ids({ minPrice: 5000000, maxPrice: 9000000, minArea: 35, maxArea: 35 }),
    ["1"],
  );
  assert.deepEqual(ids({ maxPrice: 9000000 }), ["1", "2"]);
  assert.deepEqual(ids({ maxArea: 100 }), ["1", "2"]);
  assert.equal(ids({}).length, 3);
  assert.ok(
    importFilterError({ ...emptyImportFilters(), minArea: 65, maxArea: 35 }),
  );
  assert.ok(importFilterError({ ...emptyImportFilters(), minPrice: -1 }));
  assert.deepEqual(ids({ minPrice: "broken" }), []);
});

test("import search supports IDs, addresses, developer and studio rooms without including unknown rooms", () => {
  assert.deepEqual(ids({ rooms: "0" }), ["1"]);
  assert.deepEqual(
    ids({
      query: "застройщик б",
      city: "Калининград",
      category: "Квартиры",
      developer: "Застройщик Б",
    }),
    ["2"],
  );
  assert.deepEqual(ids({ query: " мира, 1 ", status: "ready" }), ["1"]);
  assert.deepEqual(ids({ status: "imported" }), ["2"]);
  assert.deepEqual(ids({ status: "unsupported" }), ["3"]);
});

test("import sorting keeps unknown values last in both directions and does not reorder the source", () => {
  assert.deepEqual(ids({ sort: "price-desc" }), ["2", "1", "3"]);
  assert.deepEqual(ids({ sort: "area-asc" }), ["1", "2", "3"]);
  assert.deepEqual(
    items.map((item) => item.id),
    ["1", "2", "3"],
  );
});
