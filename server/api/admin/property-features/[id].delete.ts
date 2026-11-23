import { createError, defineEventHandler, getRouterParam } from 'h3';
import { db } from '../../../utils/db';
import { lockPropertyRelations } from '../../../utils/property-relations';

export default defineEventHandler(async (event) => db.$transaction(async (tx) => {
  await lockPropertyRelations(tx);
  const deleted = await tx.propertyFeature.deleteMany({ where: { id: getRouterParam(event, 'id')! } });
  if (!deleted.count)
    throw createError({ statusCode: 404, data: { message: 'Преимущество не найдено.' } });
  return { ok: true };
}));
