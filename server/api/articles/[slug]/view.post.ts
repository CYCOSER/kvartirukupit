import { db } from "../../../utils/db";
import { getOrCreateArticleVisitorSession } from "../../../utils/article-statistics";

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, "slug");
  if (!slug)
    throw createError({ statusCode: 404, statusMessage: "Статья не найдена" });

  const article = await db.article.findFirst({
    where: {
      slug,
      published: true,
      OR: [{ publishedAt: null }, { publishedAt: { lte: new Date() } }],
    },
    select: { id: true },
  });
  if (!article)
    throw createError({ statusCode: 404, statusMessage: "Статья не найдена" });

  const sessionId = await getOrCreateArticleVisitorSession(event);
  const stat = await db.articleStat.upsert({
    where: {
      articleId_sessionId: { articleId: article.id, sessionId },
    },
    create: { articleId: article.id, sessionId, view: new Date() },
    update: { view: new Date() },
    select: { useful: true },
  });
  const [statistics] = await db.articleStat.groupBy({
    by: ["articleId"],
    where: { articleId: article.id },
    _count: { _all: true, useful: true },
  });

  return {
    useful: stat.useful !== null,
    viewCount: statistics?._count._all ?? 0,
    usefulCount: statistics?._count.useful ?? 0,
  };
});
