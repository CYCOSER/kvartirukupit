export default defineEventHandler(async (event) => {
  const article = await db.article.findUnique({
    where: { id: getRouterParam(event, 'id') },
  });
  if (!article)
    throw createError({ statusCode: 404, statusMessage: 'Article not found' });
  return article;
});
