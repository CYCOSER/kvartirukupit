import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { db } from '../../../utils/db';
import { propertyFeatureSchema } from '../../../../shared/property-feature';

export default defineEventHandler(async (event) => {
  const parsed = propertyFeatureSchema.pick({ name: true }).strict().safeParse(await readBody(event));
  if (!parsed.success)
    throw createError({ statusCode: 400, data: { message: 'Укажите название преимущества. Группу менять нельзя.' } });
  try {
    return await db.propertyFeature.update({ where: { id: getRouterParam(event, 'id')! }, data: parsed.data });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      if (error.code === 'P2002')
        throw createError({ statusCode: 409, data: { message: 'Преимущество с таким названием уже есть в этой группе.' } });
      if (error.code === 'P2025')
        throw createError({ statusCode: 404, data: { message: 'Преимущество не найдено.' } });
    }
    throw error;
  }
});
