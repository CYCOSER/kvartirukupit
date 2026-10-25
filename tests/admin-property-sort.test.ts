import test from "node:test";
import assert from "node:assert/strict";
import { sortAdminProperties } from "../shared/admin-property-sort";

const items = [
  {
    title: "Квартира 10",
    price: null,
    area: 70,
    status: "sold" as const,
    published: true,
  },
  {
    title: "Квартира 2",
    price: 5000000,
    area: null,
    status: "available" as const,
    published: false,
  },
  {
    title: "Квартира 1",
    price: 9000000,
    area: 40,
    status: "reserved" as const,
    published: true,
  },
];
const names = (values: typeof items) => values.map((item) => item.title);
test("admin headers sort names naturally and numeric values with unknowns last in both directions", () => {
  const original = structuredClone(items);
  assert.deepEqual(names(sortAdminProperties(items, "title", "asc")), [
    "Квартира 1",
    "Квартира 2",
    "Квартира 10",
  ]);
  assert.deepEqual(names(sortAdminProperties(items, "title", "desc")), [
    "Квартира 10",
    "Квартира 2",
    "Квартира 1",
  ]);
  assert.deepEqual(
    sortAdminProperties(items, "price", "asc").map((item) => item.price),
    [5000000, 9000000, null],
  );
  assert.deepEqual(
    sortAdminProperties(items, "price", "desc").map((item) => item.price),
    [9000000, 5000000, null],
  );
  assert.deepEqual(
    sortAdminProperties(items, "area", "asc").map((item) => item.area),
    [40, 70, null],
  );
  assert.deepEqual(
    sortAdminProperties(items, "area", "desc").map((item) => item.area),
    [70, 40, null],
  );
  assert.deepEqual(items, original);
});
test("admin headers sort availability and publication while keeping ties stable", () => {
  assert.deepEqual(
    sortAdminProperties(items, "status", "asc").map((item) => item.status),
    ["available", "reserved", "sold"],
  );
  assert.deepEqual(
    sortAdminProperties(items, "status", "desc").map((item) => item.status),
    ["sold", "reserved", "available"],
  );
  assert.deepEqual(names(sortAdminProperties(items, "published", "asc")), [
    "Квартира 2",
    "Квартира 10",
    "Квартира 1",
  ]);
  assert.deepEqual(names(sortAdminProperties(items, "published", "desc")), [
    "Квартира 10",
    "Квартира 1",
    "Квартира 2",
  ]);
  assert.deepEqual(sortAdminProperties(items, null, "asc"), items);
});
