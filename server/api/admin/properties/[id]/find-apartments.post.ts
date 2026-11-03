import { z } from 'zod';
import { findComplexApartments } from '../../../../utils/find-complex-apartments';

export default defineEventHandler(async (event) => {
  const body = z.object({ source: z.enum(['local', 'nmarket', 'rf39']), snapshot: z.literal('saved').optional() }).strict().safeParse(await readBody(event));
  if (!body.success) throw createError({ statusCode: 400, data: { message: 'Выберите источник поиска квартир.' } });
  const { apartmentMatches, ...result } = await findComplexApartments(useRuntimeConfig(event), getRouterParam(event, 'id')!, body.data);
  return result;
});
