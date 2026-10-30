import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createApp, toWebHandler } from "h3";
import { db } from "../server/utils/db";
import list from "../server/api/admin/properties/index.get";

function fixture(t: TestContext) {
  const original = db.property.findMany;
  const find = t.mock.fn(async (..._args: any[]) => []);
  db.property.findMany = find as any;
  t.after(() => {
    db.property.findMany = original;
  });
  const handle = toWebHandler(createApp().use("/properties", list));
  return {
    find,
    request: (query = "") =>
      handle(new Request("http://localhost/properties" + query)),
  };
}

test("admin list fetches only table fields and one thumbnail per object", async (t) => {
  const { find, request } = fixture(t);
  assert.equal((await request("?view=list")).status, 200);
  const query = find.mock.calls[0]!.arguments[0];
  assert.deepEqual(
    Object.keys(query.select).sort(),
    [
      "id",
      "title",
      "type",
      "location",
      "address",
      "price",
      "area",
      "status",
      "published",
      "featured",
      "elite",
      "housingMarket",
      "demo",
      "sourceUrl",
      "sourceName",
      "images",
    ].sort(),
  );
  assert.deepEqual(query.select.images, {
    orderBy: { order: "asc" },
    take: 1,
    select: { file: true },
  });
  assert.deepEqual(query.orderBy, [{ updatedAt: "desc" }, { id: "asc" }]);
  assert.equal(query.include, undefined);
});

test("existing callers can still fetch complete records and filter complexes", async (t) => {
  const { find, request } = fixture(t);
  assert.equal((await request("?type=complex")).status, 200);
  const query = find.mock.calls[0]!.arguments[0];
  assert.deepEqual(query.where, { type: "complex" });
  assert.deepEqual(query.include, { images: { orderBy: { order: "asc" } } });
  assert.equal(query.select, undefined);
});

test("invalid list options are rejected before querying the database", async (t) => {
  const { find, request } = fixture(t);
  for (const query of [
    "?view=unknown",
    "?type=unknown",
    "?view=list&view=unknown",
  ]) {
    assert.equal((await request(query)).status, 400);
  }
  assert.equal(find.mock.callCount(), 0);
});
