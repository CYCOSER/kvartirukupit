import { createError, defineEventHandler, readBody } from 'h3';
import { db } from '../../../utils/db';
import { propertyFeatureSchema } from '../../../../shared/property-feature';

export default defineEventHandler(async (event) => {
  const parsed = propertyFeatureSchema.strict().safeParse(await readBody(event));
  if (!parsed.success)
    throw createError({ statusCode: 400, data: { message: 'Укажите название преимущества и группу.' } });
  try {
    return await db.propertyFeature.create({ data: parsed.data });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002')
      throw createError({ statusCode: 409, data: { message: 'Преимущество с таким названием уже есть в этой группе.' } });
    throw error;
  }
});
