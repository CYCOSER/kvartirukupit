import { articlePublicationState } from '~/server/utils/article-publication-state';
import { scheduleArticlePublication } from '~/server/utils/article-publication';
import { parseArticleBody } from '~/server/utils/article-content';
export default defineEventHandler(async (event) => {
  const parsed = await parseArticleBody(event);
  if (!parsed.success)
    throw createError({ statusCode: 400, statusMessage: 'Invalid article' });
  const id = getRouterParam(event, 'id');
  const current = await db.article.findUnique({ where: { id } });
  if (!current)
    throw createError({ statusCode: 404, statusMessage: 'Article not found' });
  const publication = articlePublicationState(
    parsed.data.published,
    parsed.data.publishedAt ? new Date(parsed.data.publishedAt) : null,
    current.published ? current.publishedAt : null,
  );
  try {
    const article = await db.article.update({
      where: { id },
      data: {
        ...parsed.data,
        ...publication,
      },
    });
    scheduleArticlePublication(article.id, article.publishedAt);
    return article;
  } catch (error: any) {
    if (error.code === 'P2002')
      throw createError({ statusCode: 409, statusMessage: 'Slug exists' });
    throw error;
  }
});
