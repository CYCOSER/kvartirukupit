import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, resolve } from 'node:path';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  const article = await db.article.findUnique({ where: { id } });
  if (!article)
    throw createError({ statusCode: 404, statusMessage: 'Article not found' });

  const file = (await readMultipartFormData(event))?.find(
    (part) => part.name === 'file',
  );
  if (!file)
    throw createError({ statusCode: 400, statusMessage: 'Image required' });

  const converted = await convertUploadedImage(file.data, file.type);
  const directory = resolve(process.env.UPLOAD_DIR || '.data/uploads');
  const name = randomUUID() + '.webp';
  const path = resolve(directory, name);
  await mkdir(directory, { recursive: true });
  await writeFile(path, converted);

  try {
    const updated = await db.article.update({
      where: { id },
      data: { image: '/uploads/' + name },
    });
    if (article.image)
      await unlink(resolve(directory, basename(article.image))).catch(() => {});
    return { image: updated.image };
  } catch (error) {
    await unlink(path).catch(() => {});
    throw error;
  }
});
