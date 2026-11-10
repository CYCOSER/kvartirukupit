import test from "node:test";
import assert from "node:assert/strict";
import { combineTagKeywords, tagSchema } from "../shared/tag";
import { matchesTagTaskParameters, tagTaskSchema } from "../shared/tag-task";

test("tag names are trimmed and limited to 100 characters", () => {
  assert.deepEqual(tagSchema.parse({ name: "  У моря  " }), {
    name: "У моря",
  });
  assert.equal(tagSchema.safeParse({ name: " " }).success, false);
  assert.equal(tagSchema.safeParse({ name: "т".repeat(101) }).success, false);
});

test("keywords include tags without dropping or duplicating editorial keywords", () => {
  assert.equal(
    combineTagKeywords("Новостройки, Калининград", ["калининград", "У моря"]),
    "Новостройки, Калининград, У моря",
  );
  assert.equal(combineTagKeywords("", ["  ", "ЖК у моря"]), "ЖК у моря");
});

test("tag task validates fields by type and requires at least one contains value", () => {
  assert.equal(
    tagTaskSchema.safeParse({
      type: "complex",
      tag_id: "tag-1",
      params: [{ param: "sourceId", value_contain: "feed-123" }],
    }).success,
    true,
  );
  assert.equal(
    tagTaskSchema.safeParse({
      type: "apartment",
      tag_id: "tag-1",
      params: [
        { param: "price", value_contain: "10000000" },
        { param: "finish", value_contain: "чистовая" },
      ],
    }).success,
    true,
  );
  assert.equal(
    tagTaskSchema.safeParse({
      type: "apartment",
      tag_id: "tag-1",
      params: [{ param: "title", value_contain: "ЖК" }],
    }).success,
    false,
  );
  assert.equal(
    tagTaskSchema.safeParse({
      type: "article",
      tag_id: "tag-1",
      params: [{ param: "sourceId", value_contain: "feed-123" }],
    }).success,
    false,
  );
  assert.equal(
    tagTaskSchema.safeParse({
      type: "article",
      tag_id: "tag-1",
      params: [{ param: "content", value_contain: "  " }],
    }).success,
    false,
  );
});

test("tag task parameters use case-insensitive contains and combine with AND", () => {
  const params = [
    { param: "location", value_contain: "калининград" },
    { param: "price", value_contain: "2500000" },
  ];
  assert.equal(
    matchesTagTaskParameters(
      { location: "Калининград, Центр", price: 2500000 },
      params,
    ),
    true,
  );
  assert.equal(
    matchesTagTaskParameters(
      { location: "Калининград, Центр", price: 2500001 },
      params,
    ),
    false,
  );
});
