import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyImportFilters,
  filterImportObjects,
  importFilterError,
  matchesImportExclusions,
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

test("import exclusions combine with positive filters and match any excluded field or phrase", () => {
  assert.deepEqual(ids({
    city: "Калининград",
    exclusions: { text: "", values: { developer: ["Застройщик Б"] } },
  }), ["1"]);
  assert.deepEqual(ids({
    exclusions: { text: "  МИРА, 1  ;\n несуществующий адрес ", values: {} },
  }), ["3"]);
  assert.deepEqual(ids({
    exclusions: { text: "квартира 1", values: { city: ["Зеленоградск"], developer: ["Застройщик Б"] } },
  }), []);
  assert.deepEqual(ids({
    exclusions: { text: "", values: { category: ["Квартиры", "ЖК"] } },
  }), []);
  assert.deepEqual(ids({
    category: "Квартиры",
    exclusions: { text: "", values: { category: ["Квартиры"] } },
  }), []);
});

test("import room exclusions distinguish studios, four or more rooms and missing data", () => {
  const apartments = [
    ...items,
    { ...items[0]!, id: "4", bedrooms: 4 },
    { ...items[0]!, id: "5", bedrooms: 5 },
  ];
  const keep = (rooms: string[]) => apartments
    .filter(item => matchesImportExclusions(item, { text: "", values: { rooms } }))
    .map(item => item.id);
  assert.deepEqual(keep(["0"]), ["2", "3", "4", "5"]);
  assert.deepEqual(keep(["4+"]), ["1", "2", "3"]);
  assert.deepEqual(keep(["unknown"]), ["1", "2", "4", "5"]);
  assert.deepEqual(keep(["0", "4+", "unknown"]), ["2"]);
});

test("import status exclusions keep overlapping imported and unsupported semantics", () => {
  const importedUnsupported = { ...items[2]!, existingId: "existing-complex" };
  for (const status of ["imported", "unsupported"]) {
    assert.equal(matchesImportExclusions(importedUnsupported, { text: "", values: { status: [status] } }), false);
  }
  assert.equal(matchesImportExclusions(importedUnsupported, { text: "", values: { status: ["ready"] } }), true);
  assert.deepEqual(ids({ exclusions: { text: "", values: { status: ["ready"] } } }), ["2", "3"]);
  assert.deepEqual(ids({ exclusions: { text: "", values: { status: ["ready", "imported"] } } }), ["3"]);
  assert.deepEqual(ids({ exclusions: { text: "", values: { status: ["unsupported"] } } }), ["1", "2"]);
});

test("empty import exclusions retain missing metadata and reset without shared mutable state", () => {
  assert.deepEqual(ids({ exclusions: { text: " ; \n ", values: { city: [], rooms: [] } } }), ["1", "2", "3"]);
  assert.deepEqual(ids({ exclusions: { text: "", values: { developer: ["Застройщик А", "Застройщик Б"] } } }), ["3"]);
  const first = emptyImportFilters();
  first.exclusions.values.city = ["Калининград"];
  first.exclusions.text = "Комплекс";
  assert.deepEqual(filterImportObjects(items, first), []);
  Object.assign(first, emptyImportFilters());
  assert.equal(filterImportObjects(items, first).length, 3);
  assert.deepEqual(emptyImportFilters().exclusions, { text: "", values: {} });
});
