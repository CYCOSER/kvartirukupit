import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prepareFloorPlanImage } from '../../../../../../utils/image';
import { readPropertyImage } from '../../../../../../utils/property-image';

export default defineEventHandler(async event => {
  const propertyId = getRouterParam(event, 'id')!;
  const id = getRouterParam(event, 'imageId')!;
  const image = await db.propertyImage.findFirst({ where: { id, propertyId } });
  if (!image) throw createError({ statusCode: 404, statusMessage: 'Not found' });
  if (image.kind === 'plan') return image;
  const originalFile = image.originalFile || image.file;
  const dir = resolve(process.env.UPLOAD_DIR || '.data/uploads');
  const converted = await prepareFloorPlanImage(await readPropertyImage(originalFile));
  const name = randomUUID() + '.webp';
  const file = '/uploads/' + name;
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(resolve(dir, name), converted.buffer, { flag: 'wx' });
    const updated = await db.$transaction(async tx => {
      const changed = await tx.propertyImage.updateMany({ where: { id, propertyId, file: image.file, kind: image.kind }, data: { file, originalFile, crop: Prisma.DbNull, hueShift: converted.hueShift, kind: 'plan' } });
      const current = await tx.propertyImage.findFirst({ where: { id, propertyId } });
      if (!current || (!changed.count && current.kind !== 'plan'))
        throw createError({ statusCode: 409, data: { message: 'Галерея изменилась. Обновите страницу и повторите попытку.' } });
      return current;
    });
    if (updated.file !== file) await unlink(resolve(dir, name));
    return updated;
  } catch (error) {
    await unlink(resolve(dir, name)).catch(() => {});
    throw error;
  }
});
