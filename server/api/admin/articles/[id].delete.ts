import { scheduleArticlePublication } from '~/server/utils/article-publication';
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  if (!id)
    throw createError({ statusCode: 404, statusMessage: 'Article not found' });
  const deleted = await db.article.deleteMany({
    where: { id },
  });
  if (!deleted.count)
    throw createError({ statusCode: 404, statusMessage: 'Article not found' });
  scheduleArticlePublication(id, null);
  return { ok: true };
});
