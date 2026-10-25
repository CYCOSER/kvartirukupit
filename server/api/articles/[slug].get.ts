export default defineEventHandler(async (event) => {
  const article = await db.article.findFirst({
    where: { slug: getRouterParam(event, 'slug'), published: true },
  });
  if (!article)
    throw createError({ statusCode: 404, statusMessage: 'Статья не найдена' });
  return article;
});
