import { z } from 'zod';
import { getRf39Snapshot } from '../../../utils/rf39-snapshot';
import { rf39CatalogItems } from '../../../utils/rf39-data';
import { getRf39FeedUrl } from '../../../utils/rf39-feed-settings';

export default defineEventHandler(async (event) => {
  const query = z.object({ offset: z.coerce.number().int().min(0).max(100000).default(0), refresh: z.literal('1').optional() }).safeParse(getQuery(event));
  if (!query.success || (query.data.refresh && query.data.offset !== 0))
    throw createError({ statusCode: 400, data: { message: 'Некорректная страница списка. Обновление начинается с первой страницы.' } });
  const config = useRuntimeConfig(event);
  const snapshot = await getRf39Snapshot(await getRf39FeedUrl(), config.rf39SnapshotPath, !!query.data.refresh);
  const catalog = rf39CatalogItems(snapshot.items);
  const items = catalog.slice(query.data.offset, query.data.offset + 100);
  const sourceIds = [...new Set(items.flatMap(item => [item.sourceId, item.legacySourceId].filter((id): id is string => !!id)))];
  const [existing, aliases] = await Promise.all([db.property.findMany({
    where: { sourceId: { in: sourceIds } },
    select: { sourceId: true, id: true, type: true },
  }), db.propertyImportSource.findMany({ where: { sourceId: { in: sourceIds } },
    select: { sourceId: true, propertyId: true, property: { select: { type: true } } } })]);
  const ids = new Map([
    ...aliases.map(item => [item.sourceId, { id: item.propertyId, type: item.property.type }] as const),
    ...existing.map(item => [item.sourceId, { id: item.id, type: item.type }] as const),
  ]);
  return {
    items: items.map(item => ({ ...item.summary, type: item.type, complexSourceId: item.complexSourceId,
      complexTitle: item.complexTitle,
      existingId: [ids.get(item.sourceId), item.type === 'complex' && item.legacySourceId ? ids.get(item.legacySourceId) : undefined]
        .find(existing => existing?.type === item.type)?.id || null })),
    nextOffset: query.data.offset + items.length < catalog.length ? query.data.offset + items.length : null,
    snapshot: 'saved', snapshotDate: snapshot.snapshotDate, errors: snapshot.errors,
  };
});
