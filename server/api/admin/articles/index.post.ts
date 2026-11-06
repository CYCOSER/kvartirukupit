import { articleSchema } from '~/shared/article';
import { articlePublicationState } from '~/server/utils/article-publication-state';
import { scheduleArticlePublication } from '~/server/utils/article-publication';
export default defineEventHandler(async (event) => {
  const parsed = articleSchema.safeParse(await readBody(event));
  if (!parsed.success)
    throw createError({ statusCode: 400, statusMessage: 'Invalid article' });
  const publication = articlePublicationState(
    parsed.data.published,
    parsed.data.publishedAt ? new Date(parsed.data.publishedAt) : null,
  );
  try {
    const article = await db.article.create({
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
