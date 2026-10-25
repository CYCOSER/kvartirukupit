import { articleSchema } from '~/shared/article';
export default defineEventHandler(async (event) => {
  const parsed = articleSchema.safeParse(await readBody(event));
  if (!parsed.success)
    throw createError({ statusCode: 400, statusMessage: 'Invalid article' });
  const id = getRouterParam(event, 'id');
  const current = await db.article.findUnique({ where: { id } });
  if (!current)
    throw createError({ statusCode: 404, statusMessage: 'Article not found' });
  try {
    return await db.article.update({
      where: { id },
      data: {
        ...parsed.data,
        publishedAt:
          current.publishedAt ?? (parsed.data.published ? new Date() : null),
      },
    });
  } catch (error: any) {
    if (error.code === 'P2002')
      throw createError({ statusCode: 409, statusMessage: 'Slug exists' });
    throw error;
  }
});
