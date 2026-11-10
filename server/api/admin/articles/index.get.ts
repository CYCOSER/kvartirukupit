import { sanitizeArticleContent } from "~/server/utils/article-content";

export default defineEventHandler(async () => {
  const articles = await db.article.findMany({
    orderBy: { updatedAt: "desc" },
  });
  return articles.map((article) => ({
    ...article,
    content: sanitizeArticleContent(article.content),
  }));
});
