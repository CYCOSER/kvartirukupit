import { createError, defineEventHandler, readBody } from 'h3';
import { feedSyncInputSchema } from '../../../shared/feed-sync';
import { saveRf39FeedSettings } from '../../utils/rf39-feed-settings';
import { requireAdmin } from '../../utils/security';

export default defineEventHandler(async event => {
  const owner = await requireAdmin(event);
  const parsed = feedSyncInputSchema.safeParse(await readBody(event));
  if (!parsed.success) throw createError({ statusCode: 400, data: { message: 'Проверьте ссылку XML и интервал от 15 до 10080 минут.' } });
  return saveRf39FeedSettings(owner.id, parsed.data);
});
