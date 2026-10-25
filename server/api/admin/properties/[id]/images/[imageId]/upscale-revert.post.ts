import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { z } from 'zod';
import { db } from '../../../../../../utils/db';
import { readPropertyImage } from '../../../../../../utils/property-image';

export default defineEventHandler(async event => {
  const body = z.object({ expectedFile: z.string().min(1).max(500) }).strict().safeParse(await readBody(event));
  if (!body.success) throw createError({ statusCode: 400, data: { message: 'Обновите фото и повторите попытку.' } });
  const propertyId = getRouterParam(event, 'id');
  const id = getRouterParam(event, 'imageId');
  const image = await db.propertyImage.findFirst({ where: { id, propertyId }, include: { upscale: true } });
  if (!image) throw createError({ statusCode: 404, statusMessage: 'Not found' });
  const conflict = () => createError({ statusCode: 409, data: { message: 'Фото изменилось. Откройте его заново.' } });
  const job = image.upscale;
  if (image.file !== body.data.expectedFile || job?.status !== 'completed' || job.outputFile !== image.file) throw conflict();
  await readPropertyImage(job.sourceFile);
  return db.$transaction(async tx => {
    const reverted = await tx.imageUpscale.updateMany({ where: {
      imageId: image.id, status: 'completed', outputFile: image.file, updatedAt: job.updatedAt,
    }, data: { status: 'reverted', token: null, error: null } });
    if (!reverted.count) throw conflict();
    const changed = await tx.propertyImage.updateMany({ where: { id, propertyId, file: image.file }, data: { file: job.sourceFile } });
    if (!changed.count) throw conflict();
    return tx.propertyImage.findFirstOrThrow({ where: { id, propertyId } });
  });
});
