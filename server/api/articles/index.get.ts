export default defineEventHandler(async () => {
  const articles = await db.article.findMany({
    where: {
      published: true,
      OR: [{ publishedAt: null }, { publishedAt: { lte: new Date() } }],
    },
    orderBy: { publishedAt: 'desc' },
    select: {
      id: true,
      slug: true,
      title: true,
      excerpt: true,
      image: true,
      imageAlt: true,
      publishedAt: true,
    },
  });
  const statistics = articles.length
    ? await db.articleStat.groupBy({
        by: ['articleId'],
        where: { articleId: { in: articles.map(({ id }) => id) } },
        _count: { _all: true, useful: true },
      })
    : [];
  const statisticsByArticle = new Map(
    statistics.map(({ articleId, _count }) => [
      articleId,
      { viewCount: _count._all, usefulCount: _count.useful },
    ]),
  );

  return articles.map((article) => ({
    ...article,
    viewCount: statisticsByArticle.get(article.id)?.viewCount || 0,
    usefulCount: statisticsByArticle.get(article.id)?.usefulCount || 0,
  }));
});
