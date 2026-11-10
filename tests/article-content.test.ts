import test from "node:test";
import assert from "node:assert/strict";
import { articleContentToHtml, isArticleHtml } from "../shared/article-content";
import { sanitizeArticleContent } from "../server/utils/article-content";
import { articleSchema } from "../shared/article";

test("legacy article content is converted to editor-compatible HTML", () => {
  assert.equal(
    articleContentToHtml(
      "Первый абзац.\n\n## Заголовок\n\n- Первый пункт\n- Второй пункт\n\n[Ссылка](https://example.com)",
    ),
    '<p>Первый абзац.</p><h2>Заголовок</h2><ul><li>Первый пункт</li><li>Второй пункт</li></ul><p><a href="https://example.com">Ссылка</a></p>',
  );
  assert.equal(
    articleContentToHtml("Текст <script>alert(1)</script>"),
    "<p>Текст &lt;script&gt;alert(1)&lt;/script&gt;</p>",
  );
  assert.equal(isArticleHtml("<p>Новая статья</p>"), true);
});

test("article HTML sanitizer removes dangerous elements and URLs", () => {
  const clean = sanitizeArticleContent(
    '<p>Безопасный <strong>текст</strong></p><script>alert(1)</script><a href="javascript:alert(1)">ссылка</a>',
  );

  assert.equal(clean.includes("<script"), false);
  assert.equal(clean.includes("javascript:"), false);
  assert.match(clean, /<strong>текст<\/strong>/);
  assert.match(clean, /<a[^>]*>ссылка<\/a>/);
});

test("article content limits validate visible text rather than HTML markup", () => {
  const article = {
    title: "Тестовая статья",
    slug: "testovaya-statya",
    excerpt: "Краткий анонс статьи.",
    published: false,
  };

  assert.equal(
    articleSchema.safeParse({
      ...article,
      content: `<p>${"А".repeat(30)}</p>`,
    }).success,
    true,
  );
  assert.equal(
    articleSchema.safeParse({
      ...article,
      content: "<p>Короткий</p>",
    }).success,
    false,
  );
  assert.equal(
    articleSchema.safeParse({
      ...article,
      content: `<p>${"&lt;".repeat(29)}</p>`,
    }).success,
    false,
  );
  assert.equal(
    articleSchema.safeParse({
      ...article,
      content: `<p>${"А".repeat(50001)}</p>`,
    }).success,
    false,
  );
});
