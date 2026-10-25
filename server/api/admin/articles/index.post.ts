import { articleSchema } from '~/shared/article';
export default defineEventHandler(async (event) => {
  const parsed = articleSchema.safeParse(await readBody(event));
  if (!parsed.success)
    throw createError({ statusCode: 400, statusMessage: 'Invalid article' });
  try {
    return await db.article.create({
      data: {
        ...parsed.data,
        publishedAt: parsed.data.published ? new Date() : null,
      },
    });
  } catch (error: any) {
    if (error.code === 'P2002')
      throw createError({ statusCode: 409, statusMessage: 'Slug exists' });
    throw error;
  }
});
