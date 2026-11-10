import test from "node:test";
import assert from "node:assert/strict";
import { articlePublicationState } from "../server/utils/article-publication-state";
import { articleSchema, articleSlugFromTitle } from "../shared/article";
import { randomArticleRecommendations } from "../shared/article-recommendations";

test("article recommendations are shuffled and limited to three", () => {
  const candidates = ["one", "two", "three", "four", "five"];
  const selected = randomArticleRecommendations(candidates, 3, () => 0);

  assert.equal(selected.length, 3);
  assert.deepEqual(selected, ["two", "three", "four"]);
  assert.deepEqual(
    randomArticleRecommendations(candidates, 2, () => 0),
    ["two", "three"],
  );
  assert.deepEqual(candidates, ["one", "two", "three", "four", "five"]);
});

test("article title slug is transliterated and normalized", () => {
  assert.equal(
    articleSlugFromTitle("Как выбрать новостройку: ЖК «Северный»!"),
    "kak-vybrat-novostroyku-zhk-severnyy",
  );
  assert.equal(
    articleSlugFromTitle("  Ёжик и 100 квартир  "),
    "yozhik-i-100-kvartir",
  );
});

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

test("article image SEO and keywords support old articles, trimming and bounded text", () => {
  const article = {
    title: "Тестовая статья",
    slug: "testovaya-statya",
    excerpt: "Краткий анонс статьи.",
    content: "Достаточно длинный текст тестовой статьи для проверки схемы.",
  };
  const legacy = articleSchema.parse(article);
  assert.equal(legacy.imageAlt, "");
  assert.equal(legacy.seoKeywords, "");

  const result = articleSchema.parse({
    ...article,
    imageAlt: "  Жилой квартал у моря  ",
    seoKeywords: "  новостройки, Калининград, квартира у моря  ",
  });
  assert.equal(result.imageAlt, "Жилой квартал у моря");
  assert.equal(result.seoKeywords, "новостройки, Калининград, квартира у моря");

  for (const [field, limit] of [["imageAlt", 250], ["seoKeywords", 1000]] as const) {
    assert.equal(articleSchema.safeParse({ ...article, [field]: "А".repeat(limit) }).success, true);
    assert.equal(articleSchema.safeParse({ ...article, [field]: "А".repeat(limit + 1) }).success, false);
    assert.equal(articleSchema.safeParse({ ...article, [field]: ["текст"] }).success, false);
  }
});
