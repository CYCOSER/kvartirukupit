import { createError, defineEventHandler, getRouterParam } from 'h3';
import { db } from '../../../../../../utils/db';
import { upscaleState } from '../../../../../../utils/upscale';

export default defineEventHandler(async event => {
  const image = await db.propertyImage.findFirst({ where: { id: getRouterParam(event, 'imageId'), propertyId: getRouterParam(event, 'id') }, include: { upscale: true } });
  if (!image) throw createError({ statusCode: 404, statusMessage: 'Not found' });
  return { ...upscaleState(image), file: image.file };
});
