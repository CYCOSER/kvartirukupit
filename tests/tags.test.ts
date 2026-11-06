import test from "node:test";
import assert from "node:assert/strict";
import { tagSchema } from "../shared/tag";

test("tag names are trimmed and limited to 100 characters", () => {
  assert.deepEqual(tagSchema.parse({ name: "  У моря  " }), {
    name: "У моря",
  });
  assert.equal(tagSchema.safeParse({ name: " " }).success, false);
  assert.equal(tagSchema.safeParse({ name: "т".repeat(101) }).success, false);
});
