export default defineEventHandler(async (event) => {
  const article = await db.article.findFirst({
    where: {
      slug: getRouterParam(event, 'slug'),
      published: true,
      OR: [{ publishedAt: null }, { publishedAt: { lte: new Date() } }],
    },
  });
  if (!article)
    throw createError({ statusCode: 404, statusMessage: 'Статья не найдена' });
  return article;
});
