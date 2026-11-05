import { createError, defineEventHandler, readBody } from 'h3';
import { feedSyncRunSchema } from '../../../../shared/feed-sync';
import { startRf39FeedSync } from '../../../utils/rf39-feed-settings';
import { requireAdmin } from '../../../utils/security';

export default defineEventHandler(async event => {
  const owner = await requireAdmin(event);
  const parsed = feedSyncRunSchema.safeParse(await readBody(event));
  if (!parsed.success) throw createError({ statusCode: 400, data: { message: 'Не удалось определить запрос синхронизации. Обновите страницу.' } });
  return startRf39FeedSync(owner.id, parsed.data.requestId);
});
