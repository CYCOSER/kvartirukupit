import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createApp, toWebHandler } from "h3";
import { db } from "../server/utils/db";
import bulk from "../server/api/admin/properties/bulk.post";

const app = createApp().use("/bulk", bulk);
const handle = toWebHandler(app);
const request = (body: unknown) =>
  handle(
    new Request("http://localhost/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

function mockWrites(t: TestContext, count: number) {
  const original = {
    updateMany: db.property.updateMany,
    deleteMany: db.property.deleteMany,
  };
  const update = t.mock.fn(async (..._args: unknown[]) => ({ count }));
  const remove = t.mock.fn(async (..._args: unknown[]) => ({ count }));
  db.property.updateMany = update as any;
  db.property.deleteMany = remove as any;
  t.after(() => Object.assign(db.property, original));
  return { update, remove };
}

test("bulk publication changes only the publication flag of selected IDs", async (t) => {
  const { update, remove } = mockWrites(t, 2);
  for (const action of ["publish", "unpublish"]) {
    const response = await request({ action, ids: ["one", "two"] });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { count: 2 });
    assert.deepEqual(update.mock.calls.at(-1)!.arguments, [
      {
        where: { id: { in: ["one", "two"] } },
        data: { published: action === "publish" },
      },
    ]);
  }
  assert.equal(remove.mock.callCount(), 0);
});

test("bulk deletion is restricted to selected IDs", async (t) => {
  const { update, remove } = mockWrites(t, 1);
  const response = await request({
    action: "delete",
    ids: ["one", "already-gone"],
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { count: 1 });
  assert.deepEqual(remove.mock.calls[0]!.arguments, [
    { where: { id: { in: ["one", "already-gone"] } } },
  ]);
  assert.equal(update.mock.callCount(), 0);
});

test("invalid or oversized selections never reach the database", async (t) => {
  const { update, remove } = mockWrites(t, 0);
  for (const body of [
    {},
    null,
    { action: "delete" },
    { action: "delete", ids: [] },
    { action: "delete", ids: [""] },
    { action: "delete", ids: [" "] },
    { action: "delete", ids: [42] },
    { action: "delete", ids: ["x".repeat(101)] },
    { action: "delete", ids: Array(501).fill("one") },
    { action: "unsupported", ids: ["one"] },
    { action: "delete", ids: ["one"], where: {} },
  ]) {
    assert.equal((await request(body)).status, 400, JSON.stringify(body));
  }
  assert.equal(update.mock.callCount(), 0);
  assert.equal(remove.mock.callCount(), 0);
});
