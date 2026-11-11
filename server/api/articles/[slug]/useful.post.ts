import { db } from "../../../utils/db";
import { getArticleVisitorSessionId } from "../../../utils/article-statistics";

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

  const sessionId = await getArticleVisitorSessionId(event);
  if (!sessionId)
    throw createError({ statusCode: 409, statusMessage: "Просмотр не найден" });

  const key = { articleId: article.id, sessionId };
  const stat = await db.articleStat.findUnique({
    where: { articleId_sessionId: key },
    select: { useful: true },
  });
  if (!stat)
    throw createError({ statusCode: 409, statusMessage: "Просмотр не найден" });

  if (stat.useful === null) {
    await db.articleStat.updateMany({
      where: { ...key, useful: null },
      data: { useful: new Date() },
    });
  }

  const [statistics] = await db.articleStat.groupBy({
    by: ["articleId"],
    where: { articleId: article.id },
    _count: { _all: true, useful: true },
  });

  return {
    useful: true,
    viewCount: statistics?._count._all ?? 0,
    usefulCount: statistics?._count.useful ?? 0,
  };
});
