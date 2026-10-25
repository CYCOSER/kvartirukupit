import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '../../../../../../utils/db';
import { editImage } from '../../../../../../utils/image';
import { readPropertyImage } from '../../../../../../utils/property-image';
import { upscaleState } from '../../../../../../utils/upscale';

const edits = z.object({
  expectedFile: z.string().min(1).max(500),
  crop: z.object({ left: z.number().int().min(0), top: z.number().int().min(0), width: z.number().int().positive(), height: z.number().int().positive() }).strict().nullable(),
  hueShift: z.number().int().min(-180).max(180),
}).strict();

export default defineEventHandler(async event => {
  const parsed = edits.safeParse(await readBody(event));
  if (!parsed.success) throw createError({ statusCode: 400, data: { message: 'Проверьте область обрезки и цветовой тон.' } });
  const { expectedFile, crop, hueShift } = parsed.data;
  const propertyId = getRouterParam(event, 'id')!;
  const id = getRouterParam(event, 'imageId')!;
  const image = await db.propertyImage.findFirst({ where: { id, propertyId }, include: { upscale: true } });
  if (!image) throw createError({ statusCode: 404, statusMessage: 'Not found' });
  const conflict = () => createError({ statusCode: 409, data: { message: 'Галерея изменилась. Откройте изображение заново и повторите правку.' } });
  if (image.file !== expectedFile) throw conflict();
  const enhanced = upscaleState(image).status === 'completed';
  const originalFile = enhanced ? image.file : image.originalFile || image.file;
  const source = await readPropertyImage(originalFile);
  const previousCrop = enhanced ? null : image.crop as typeof crop;
  if ((enhanced ? 0 : image.hueShift) === hueShift && ((!crop && !previousCrop) || (crop && previousCrop &&
    crop.left === previousCrop.left && crop.top === previousCrop.top && crop.width === previousCrop.width && crop.height === previousCrop.height))) return image;
  const dir = resolve(process.env.UPLOAD_DIR || '.data/uploads');
  let name: string | undefined;
  let file = originalFile;
  try {
    if (crop || hueShift) {
      const buffer = await editImage(source, { crop, hueShift });
      await mkdir(dir, { recursive: true });
      name = randomUUID() + '.webp';
      file = '/uploads/' + name;
      await writeFile(resolve(dir, name), buffer, { flag: 'wx' });
    }
    return await db.$transaction(async tx => {
      const changed = await tx.propertyImage.updateMany({
        where: { id, propertyId, file: expectedFile },
        data: { file, originalFile, crop: crop || Prisma.DbNull, hueShift },
      });
      if (!changed.count) throw conflict();
      return tx.propertyImage.findFirstOrThrow({ where: { id, propertyId } });
    });
  } catch (error) {
    if (name) await unlink(resolve(dir, name)).catch(() => {});
    throw error;
  }
});
