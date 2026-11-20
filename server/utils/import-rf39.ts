import { createError } from 'h3';
import type { ImportConfig, ImportExecution } from './import-execution';
import { DEFAULT_RF39_FEED_URL, fetchRf39Feed } from './rf39';
import { getRf39Snapshot } from './rf39-snapshot';
import { rf39CatalogDraft, rf39CatalogItems } from './rf39-data';
import { existingImportedProperty, importProperty } from './import-property';
import { db } from './db';
import { preferredNmarketApartment, rf39ApartmentIdentity } from './apartment-matching';
import { importNmarketProperty, prepareNmarketImport } from './import-nmarket';

export type Rf39ImportInput = { id: number | string; layoutId?: number; complexId?: string; complexSourceId?: string;
  preferredNmarketId?: string; snapshot?: 'saved'; preferredSource?: 'nmarket' | 'rf39' };
export async function importRf39Property(config: ImportConfig, input: Rf39ImportInput, execution?: ImportExecution, persistedMatch?: ReturnType<typeof preferredNmarketApartment> | null) {
  const requestedSourceId = typeof input.id === 'string' ? input.id : input.layoutId
    ? `rf39-layout:${input.id}:${input.layoutId}` : `rf39:${input.id}`;
  const linkedComplex = input.complexSourceId
    ? await existingImportedProperty(input.complexSourceId) : null;
  if (input.complexSourceId && !linkedComplex)
    throw createError({ statusCode: 409, data: { message: 'Сначала создайте карточку ЖК, чтобы привязать к ней квартиру.' } });
  const complexId = input.complexId || linkedComplex?.id;
  const existing = await existingImportedProperty(requestedSourceId, complexId, [], execution);
  if (existing) return existing;
  const source = config.rf39FeedUrl || DEFAULT_RF39_FEED_URL;
  const snapshot = input.snapshot === 'saved' ? await getRf39Snapshot(source, config.rf39SnapshotPath, 'saved') : null;
  const feed = snapshot || await fetchRf39Feed(source);
  const catalog = rf39CatalogItems(feed.items);
  const entry = typeof input.id === 'string'
    ? catalog.find(item => item.sourceId === input.id)
    : catalog.find(item => item.objectId === input.id && item.layoutId === input.layoutId && item.type === 'apartment') ||
      catalog.find(item => item.objectId === input.id && item.type === 'apartment');
  if (!entry) throw createError({ statusCode: 404, data: { message: 'Объект больше не доступен среди опубликованных объектов CRM.' } });
  const sourceId = entry.sourceId;
  const item = entry.item;
  const saved = input.snapshot === 'saved';
  const preferred = persistedMatch !== undefined ? persistedMatch || undefined : (complexId && entry.type === 'apartment'
    ? preferredNmarketApartment(complexId, sourceId, saved) : undefined);
  if (input.preferredNmarketId && preferred?.id !== input.preferredNmarketId)
    throw createError({ statusCode: 409, data: { message: 'Результат сопоставления устарел. Повторите поиск квартир в ЖК.' } });
  if (preferred && entry.type === 'apartment') {
    if (JSON.stringify(preferred.identity) !== JSON.stringify(rf39ApartmentIdentity(item, entry.layoutId)))
      throw createError({ statusCode: 409, data: { message: 'Данные CRM изменились. Повторите поиск квартир в ЖК.' } });
    if (input.preferredSource !== 'rf39')
      return importNmarketProperty(config, preferred.id, complexId, saved,
        { sourceId, apartmentKey: preferred.key, identity: preferred.identity }, execution);
  }
  let draft;
  try { draft = rf39CatalogDraft(entry); }
  catch { throw createError({ statusCode: 422, data: { message: 'Данные объекта не подходят для карточки ЖК или квартиры. Объект не импортирован.' } }); }
  if (snapshot) {
    draft.data.sourceFetchedAt = new Date(snapshot.snapshotDate);
    draft.warnings.push(`Используется сохранённая выгрузка CRM от ${snapshot.snapshotDate}. Проверьте цены и наличие.`);
  }
  if (preferred) {
    // Revalidate the duplicate before saving either source's aliases.
    const { sources } = await prepareNmarketImport(config, preferred.id, complexId, saved,
      { sourceId, apartmentKey: preferred.key, identity: preferred.identity });
    draft.warnings.push('Квартира также найдена в Нмаркете. Создана одна карточка с данными CRM RF39.');
    return importProperty(draft, complexId, true, sources.reverse(), execution);
  }
  const legacyProperty = entry.legacySourceId ? await existingImportedProperty(entry.legacySourceId) : null;
  const legacyType = legacyProperty ? await db.property.findUnique({ where: { id: legacyProperty.id }, select: { type: true } }) : null;
  const sources = entry.legacySourceId && legacyType?.type === 'complex'
    ? [{ sourceId: draft.data.sourceId }, { sourceId: entry.legacySourceId }] : undefined;
  return importProperty(draft, complexId, entry.type === 'apartment', sources, execution);
}
