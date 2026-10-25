import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { z } from 'zod';
import { db } from '../../../../../../utils/db';
import { queueUpscale, upscaleAvailable } from '../../../../../../utils/upscale';

export default defineEventHandler(async event => {
  const body = z.object({ expectedFile: z.string().min(1).max(500) }).strict().safeParse(await readBody(event));
  if (!body.success) throw createError({ statusCode: 400, data: { message: 'Обновите изображение и повторите попытку.' } });
  const image = await db.propertyImage.findFirst({ where: { id: getRouterParam(event, 'imageId'), propertyId: getRouterParam(event, 'id') } });
  if (!image) throw createError({ statusCode: 404, statusMessage: 'Not found' });
  if (image.file !== body.data.expectedFile) throw createError({ statusCode: 409, data: { message: 'Фото изменилось. Откройте его заново.' } });
  if (!upscaleAvailable()) throw createError({ statusCode: 503, data: { message: 'Сервис улучшения фото пока недоступен.' } });
  const job = await queueUpscale(image, 'manual');
  return { status: job.status };
});
