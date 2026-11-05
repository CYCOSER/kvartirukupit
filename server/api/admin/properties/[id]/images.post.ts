import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createError, defineEventHandler, getHeader, getRouterParam, readMultipartFormData } from 'h3';
import type { Prisma } from '@prisma/client';
import { db } from '../../../../utils/db';
import { convertUploadedImage } from '../../../../utils/image';
import { imageFingerprint, propertyImageFingerprint } from '../../../../utils/image-fingerprint';
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
  const hash = await imageFingerprint(converted);
  const hashes = new Map<string, string | null>();
  async function fingerprint(file: string, client?: Prisma.TransactionClient) {
    if (!hashes.has(file)) {
      try { hashes.set(file, await propertyImageFingerprint(file, undefined, client)); }
      catch (error) {
        if ((error as { statusCode?: number }).statusCode !== 400) throw error;
        console.warn('[property-images] Cannot compare gallery image', { propertyId: id, file, error });
        hashes.set(file, null);
      }
    }
    return hashes.get(file);
  }
  // Warm old galleries before taking the lock; only concurrent additions need work inside it.
  for (const image of await db.propertyImage.findMany({ where: { propertyId: id }, select: { file: true } }))
    await fingerprint(image.file);
  const dir = resolve(process.env.UPLOAD_DIR || '.data/uploads');
  await mkdir(dir, { recursive: true });
  const name = randomUUID() + '.webp';
  const uploadedFile = '/uploads/' + name;
  let written = false;
  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
      await tx.$queryRaw`SELECT "id" FROM "PropertyImage" WHERE "propertyId" = ${id} ORDER BY "id" FOR UPDATE`;
      const gallery = await tx.propertyImage.findMany({ where: { propertyId: id }, orderBy: { order: 'asc' } });
      for (const image of gallery) {
        if (await fingerprint(image.file, tx) === hash) return { ...image, duplicate: true };
      }
      const count = gallery.length;
      if (count >= 100)
        throw createError({
          statusCode: 400,
          statusMessage: 'Maximum 100 images',
        });
      await writeFile(resolve(dir, name), converted, { flag: 'wx' });
      written = true;
      await propertyImageFingerprint(uploadedFile, hash, tx);
      return tx.propertyImage.create({
        data: {
          propertyId: id,
          file: uploadedFile,
          originalFile: uploadedFile,
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
    if (written) await unlink(resolve(dir, name)).catch(error => {
      console.warn('[property-images] Cannot remove unsaved upload', { file: uploadedFile, error });
    });
    throw e;
  }
});
