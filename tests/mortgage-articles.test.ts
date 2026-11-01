import test from "node:test";
import assert from "node:assert/strict";
import { articleBlocks, articleSchema } from "../shared/article";
import { apartmentArticles } from "../prisma/apartment-articles";
import { mortgageArticles } from "../prisma/mortgage-articles";

test("mortgage articles are publishable with supported links and valid destinations", () => {
  const articles = [...apartmentArticles, ...mortgageArticles];
  const slugs = new Set(articles.map((article) => article.slug));
  assert.equal(slugs.size, articles.length);
  for (const article of mortgageArticles) {
    assert.equal(articleSchema.safeParse(article).success, true, article.slug);
    assert.equal(article.published, true);
    assert.ok(article.seoTitle && article.seoDescription, article.slug);
    const links = articleBlocks(article.content).filter((block) => block.type === "link");
    assert.equal(links.length, (article.content.match(/^\[.+\]\(.+\)$/gm) || []).length);
    assert.ok(links.some((link) => link.href.startsWith("https://")), article.slug);
    for (const link of links) {
      if (link.href.startsWith("/blog/")) {
        assert.ok(slugs.has(link.href.slice("/blog/".length)), link.href);
      }
    }
  }
});
