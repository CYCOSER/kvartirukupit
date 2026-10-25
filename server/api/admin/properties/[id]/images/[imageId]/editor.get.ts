import { createError, defineEventHandler, getRouterParam } from 'h3';
import sharp from 'sharp';
import { db } from '../../../../../../utils/db';
import { readPropertyImage } from '../../../../../../utils/property-image';
import { upscaleState } from '../../../../../../utils/upscale';

export default defineEventHandler(async event => {
  const image = await db.propertyImage.findFirst({ where: {
    id: getRouterParam(event, 'imageId'), propertyId: getRouterParam(event, 'id'),
  }, include: { upscale: true } });
  if (!image) throw createError({ statusCode: 404, statusMessage: 'Not found' });
  const originalFile = image.originalFile || image.file;
  const upscale = upscaleState(image);
  const enhanced = upscale.status === 'completed';
  const editFile = enhanced ? image.file : originalFile;
  const metadata = await sharp(await readPropertyImage(editFile), { limitInputPixels: 40000000 }).metadata();
  const { width, height } = metadata.autoOrient;
  return { file: image.file, originalFile, editFile, width, height, hueShift: enhanced ? 0 : image.hueShift,
    crop: enhanced ? null : image.crop, kind: image.kind, upscale };
});
