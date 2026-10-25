export default defineEventHandler(async (event) => {
  const deleted = await db.article.deleteMany({
    where: { id: getRouterParam(event, 'id') },
  });
  if (!deleted.count)
    throw createError({ statusCode: 404, statusMessage: 'Article not found' });
  return { ok: true };
});
