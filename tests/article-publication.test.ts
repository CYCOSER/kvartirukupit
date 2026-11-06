import test from "node:test";
import assert from "node:assert/strict";
import { articlePublicationState } from "../server/utils/article-publication-state";
import { articleSchema } from "../shared/article";

test("article publication dates schedule future articles and publish due ones", () => {
  const now = new Date("2026-11-05T12:00:00.000Z");
  const future = new Date("2026-11-06T09:30:00.000Z");
  const past = new Date("2026-11-04T09:30:00.000Z");

  assert.deepEqual(articlePublicationState(true, future, null, now), {
    published: false,
    publishedAt: future,
  });
  assert.deepEqual(articlePublicationState(true, past, null, now), {
    published: true,
    publishedAt: past,
  });
  assert.deepEqual(articlePublicationState(true, null, null, now), {
    published: true,
    publishedAt: now,
  });
  assert.deepEqual(articlePublicationState(true, null, past, now), {
    published: true,
    publishedAt: past,
  });
  assert.deepEqual(articlePublicationState(false, future, null, now), {
    published: false,
    publishedAt: null,
  });
});

test("article schema accepts scheduled publication timestamps", () => {
  const article = {
    title: "Тестовая статья",
    slug: "testovaya-statya",
    excerpt: "Краткий анонс статьи.",
    content: "Достаточно длинный текст тестовой статьи для проверки схемы.",
    published: true,
    publishedAt: "2026-11-06T09:30:00.000Z",
  };

  assert.equal(articleSchema.safeParse(article).success, true);
  assert.equal(
    articleSchema.safeParse({ ...article, publishedAt: "06.11.2026 12:30" })
      .success,
    false,
  );
});
