import { z } from 'zod';
import { findComplexApartments } from '../../../../utils/find-complex-apartments';
import { getRf39FeedUrl } from '../../../../utils/rf39-feed-settings';

export default defineEventHandler(async (event) => {
  const body = z.object({ source: z.enum(['local', 'nmarket', 'rf39']), snapshot: z.literal('saved').optional() }).strict().safeParse(await readBody(event));
  if (!body.success) throw createError({ statusCode: 400, data: { message: 'Выберите источник поиска квартир.' } });
  const config = useRuntimeConfig(event);
  const { apartmentMatches, ...result } = await findComplexApartments({ ...config,
    ...(body.data.source === 'rf39' ? { rf39FeedUrl: await getRf39FeedUrl() } : {}),
  }, getRouterParam(event, 'id')!, body.data);
  return result;
});
