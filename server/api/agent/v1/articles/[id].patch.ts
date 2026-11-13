import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { articleSchema } from '../../../../../shared/article';
import { db } from '../../../../utils/db';
import { sanitizeArticleContent } from '../../../../utils/article-content';
import { articlePublicationState } from '../../../../utils/article-publication-state';
import { scheduleArticlePublication } from '../../../../utils/article-publication';

const patchSchema = articleSchema.partial().strict().refine(
  (body) => Object.keys(body).length > 0, 'Provide at least one article field',
);

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const parsed = patchSchema.safeParse(body && typeof body.content === 'string'
    ? { ...body, content: sanitizeArticleContent(body.content) } : body);
  if (!parsed.success)
    throw createError({ statusCode: 400, statusMessage: 'Invalid article', data: parsed.error.flatten() });
  const id = getRouterParam(event, 'id');
  const current = await db.article.findUnique({ where: { id } });
  if (!current)
    throw createError({ statusCode: 404, statusMessage: 'Article not found' });

  const patch = parsed.data;
  const changesPublication = patch.published !== undefined || patch.publishedAt !== undefined;
  const publication = changesPublication ? articlePublicationState(
    patch.published ?? (current.published || Boolean(patch.publishedAt)),
    patch.publishedAt === undefined ? current.publishedAt
      : patch.publishedAt ? new Date(patch.publishedAt) : null,
    current.published ? current.publishedAt : null,
  ) : { published: current.published, publishedAt: current.publishedAt };
  try {
    const article = await db.article.update({
      // Reject a concurrent editor/import instead of overwriting its publication state.
      where: { id, updatedAt: current.updatedAt },
      data: { ...patch, ...publication },
    });
    if (changesPublication) scheduleArticlePublication(article.id, article.publishedAt);
    return { ...article, content: sanitizeArticleContent(article.content) };
  } catch (error: any) {
    if (error.code === 'P2002')
      throw createError({ statusCode: 409, statusMessage: 'Slug exists' });
    if (error.code === 'P2025')
      throw createError({ statusCode: 409, statusMessage: 'Article changed; read it again and retry' });
    throw error;
  }
});
