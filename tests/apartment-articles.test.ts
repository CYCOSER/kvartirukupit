import test from "node:test";
import assert from "node:assert/strict";
import { articleBlocks, articleSchema } from "../shared/article";
import { apartmentArticles } from "../prisma/apartment-articles";

test("apartment journal articles are publishable and cross-link to existing articles", () => {
  const slugs = new Set(apartmentArticles.map((article) => article.slug));
  assert.equal(slugs.size, apartmentArticles.length);
  for (const article of apartmentArticles) {
    assert.equal(articleSchema.safeParse(article).success, true, article.slug);
    assert.equal(article.published, true);
    assert.ok(article.seoTitle && article.seoDescription);
    const blocks = articleBlocks(article.content);
    assert.ok(blocks.some((block) => block.type === "h2"));
    for (const block of blocks) {
      if (block.type === "link" && block.href.startsWith("/blog/")) {
        assert.ok(slugs.has(block.href.slice("/blog/".length)), block.href);
      }
    }
  }
});
