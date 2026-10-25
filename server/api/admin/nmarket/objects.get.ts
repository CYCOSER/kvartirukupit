import { z } from 'zod';
import { fetchNmarketObjects, fetchNmarketSnapshot } from '../../../utils/nmarket';
import { nmarketSummary } from '../../../utils/nmarket-data';

export default defineEventHandler(async (event) => {
  const query = z.object({ offset: z.coerce.number().int().min(0).max(100000).default(0), snapshot: z.literal('saved').optional(), refresh: z.literal('1').optional() }).safeParse(getQuery(event));
  if (!query.success || (query.data.refresh && (query.data.offset !== 0 || query.data.snapshot)))
    throw createError({ statusCode: 400, data: { message: 'Некорректная страница списка. Обновление начинается с первой страницы.' } });
  const config = useRuntimeConfig(event);
  const snapshot = query.data.snapshot === 'saved' ? await fetchNmarketSnapshot(config.nmarketSnapshotPath) : null;
  const objects = snapshot ? snapshot.items : await fetchNmarketObjects(config.nmarketFeedUrl, config.nmarketSnapshotPath, !!query.data.refresh);
  const items = objects.slice(query.data.offset, query.data.offset + 100);
  const existing = await db.property.findMany({
    where: { sourceId: { in: items.map(item => `nmarket:${item.id}`) } }, select: { sourceId: true, id: true },
  });
  const ids = new Map(existing.map(item => [item.sourceId, item.id]));
  return {
    items: items.map(item => ({ ...nmarketSummary(item), existingId: ids.get(`nmarket:${item.id}`) || null })),
    nextOffset: query.data.offset + items.length < objects.length ? query.data.offset + items.length : null,
    snapshotDate: snapshot?.snapshotDate || null,
  };
});
