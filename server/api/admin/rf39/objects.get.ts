import { z } from 'zod';
import { getRf39Snapshot } from '../../../utils/rf39-snapshot';
import { rf39Summary } from '../../../utils/rf39-data';

export default defineEventHandler(async (event) => {
  const query = z.object({ offset: z.coerce.number().int().min(0).max(100000).default(0), refresh: z.literal('1').optional() }).safeParse(getQuery(event));
  if (!query.success || (query.data.refresh && query.data.offset !== 0))
    throw createError({ statusCode: 400, data: { message: 'Некорректная страница списка. Обновление начинается с первой страницы.' } });
  const config = useRuntimeConfig(event);
  const snapshot = await getRf39Snapshot(config.rf39Token, config.rf39SnapshotPath, !!query.data.refresh);
  const items = snapshot.items.slice(query.data.offset, query.data.offset + 100);
  const existing = await db.property.findMany({
    where: { sourceId: { in: items.map(item => `rf39:${item.id}`) } },
    select: { sourceId: true, id: true },
  });
  const ids = new Map(existing.map(item => [item.sourceId, item.id]));
  return {
    items: items.map(item => ({ ...rf39Summary(item), existingId: ids.get(`rf39:${item.id}`) || null })),
    nextOffset: query.data.offset + items.length < snapshot.items.length ? query.data.offset + items.length : null,
    snapshot: 'saved', snapshotDate: snapshot.snapshotDate,
  };
});
