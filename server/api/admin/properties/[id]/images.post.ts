import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  if (!(await db.property.findUnique({ where: { id } })))
    throw createError({ statusCode: 404, statusMessage: 'Not found' });
  if (Number(getHeader(event, 'content-length') || 0) > 12582912)
    throw createError({ statusCode: 413, statusMessage: 'File too large' });
  const parts = await readMultipartFormData(event);
  const file = parts?.find((p) => p.name === 'file');
  if (!file)
    throw createError({
      statusCode: 400,
      statusMessage: 'JPEG, PNG or WebP up to 10 MB required',
    });
  const converted = await convertUploadedImage(file.data, file.type);
  const dir = resolve(process.env.UPLOAD_DIR || '.data/uploads');
  await mkdir(dir, { recursive: true });
  const name = randomUUID() + '.webp';
  await writeFile(resolve(dir, name), converted);
  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
      const count = await tx.propertyImage.count({ where: { propertyId: id } });
      if (count >= 100)
        throw createError({
          statusCode: 400,
          statusMessage: 'Maximum 100 images',
        });
      return tx.propertyImage.create({
        data: {
          propertyId: id,
          file: '/uploads/' + name,
          originalFile: '/uploads/' + name,
          alt:
            parts
              ?.find((p) => p.name === 'alt')
              ?.data.toString()
              .slice(0, 200) || 'Фотография объекта',
          order: count,
        },
      });
    });
  } catch (e) {
    await unlink(resolve(dir, name));
    throw e;
  }
});
