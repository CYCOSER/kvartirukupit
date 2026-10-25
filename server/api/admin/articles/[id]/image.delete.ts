import { unlink } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  const article = await db.article.findUnique({ where: { id } });
  if (!article)
    throw createError({ statusCode: 404, statusMessage: 'Article not found' });

  await db.article.update({ where: { id }, data: { image: '' } });
  if (article.image)
    await unlink(
      resolve(
        process.env.UPLOAD_DIR || '.data/uploads',
        basename(article.image),
      ),
    ).catch(() => {});
  return { ok: true };
});
