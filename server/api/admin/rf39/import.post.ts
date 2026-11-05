import { z } from 'zod';
import { importRf39Property } from '../../../utils/import-rf39';
import { getRf39FeedUrl } from '../../../utils/rf39-feed-settings';

export default defineEventHandler(async (event) => {
  const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
  const body = z.object({ id, layoutId: id.optional(), complexId: z.string().trim().min(1).max(100).optional(),
    preferredNmarketId: z.string().regex(/^apartment:\d{1,20}$/).optional(), snapshot: z.literal('saved').optional(),
    preferredSource: z.enum(['nmarket', 'rf39']).default('nmarket') }).strict().safeParse(await readBody(event));
  if (!body.success) throw createError({ statusCode: 400, data: { message: 'Выберите объект CRM.' } });
  return importRf39Property({ ...useRuntimeConfig(event), rf39FeedUrl: await getRf39FeedUrl() }, body.data);
});
