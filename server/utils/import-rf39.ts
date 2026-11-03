import { createError } from 'h3';
import type { ImportConfig, ImportExecution } from './import-execution';
import { fetchRf39Objects } from './rf39';
import { getRf39Snapshot } from './rf39-snapshot';
import { rf39Draft, rf39LayoutDraft } from './rf39-data';
import { existingImportedProperty, importProperty } from './import-property';
import { preferredNmarketApartment, rf39ApartmentIdentity } from './apartment-matching';
import { importNmarketProperty, prepareNmarketImport } from './import-nmarket';

export type Rf39ImportInput = { id: number; layoutId?: number; complexId?: string; preferredNmarketId?: string; snapshot?: 'saved'; preferredSource?: 'nmarket' | 'rf39' };
export async function importRf39Property(config: ImportConfig, input: Rf39ImportInput, execution?: ImportExecution, persistedMatch?: ReturnType<typeof preferredNmarketApartment> | null) {
  const sourceId = input.layoutId ? `rf39-layout:${input.id}:${input.layoutId}` : `rf39:${input.id}`;
  const existing = await existingImportedProperty(sourceId, input.complexId, [], execution);
  if (existing) return existing;
  const snapshot = input.snapshot === 'saved' ? await getRf39Snapshot(config.rf39Token, config.rf39SnapshotPath, 'saved') : null;
  const items = snapshot?.items || await fetchRf39Objects(config.rf39Token, 0, input.id);
  const item = items.find(item => item.id === input.id);
  if (!item) throw createError({ statusCode: 404, data: { message: 'Объект больше не доступен среди опубликованных объектов CRM.' } });
  const saved = input.snapshot === 'saved';
  const preferred = persistedMatch !== undefined ? persistedMatch || undefined : (input.complexId ? preferredNmarketApartment(input.complexId, sourceId, saved) : undefined);
  if (input.preferredNmarketId && preferred?.id !== input.preferredNmarketId)
    throw createError({ statusCode: 409, data: { message: 'Результат сопоставления устарел. Повторите поиск квартир в ЖК.' } });
  if (preferred) {
    if (JSON.stringify(preferred.identity) !== JSON.stringify(rf39ApartmentIdentity(item, input.layoutId)))
      throw createError({ statusCode: 409, data: { message: 'Данные CRM изменились. Повторите поиск квартир в ЖК.' } });
    if (input.preferredSource !== 'rf39')
      return importNmarketProperty(config, preferred.id, input.complexId, saved,
        { sourceId, apartmentKey: preferred.key, identity: preferred.identity }, execution);
  }
  let draft;
  try { draft = input.layoutId ? rf39LayoutDraft(item, input.layoutId) : rf39Draft(item); }
  catch { throw createError({ statusCode: 422, data: { message: 'Данные объекта не подходят для карточки ЖК или квартиры. Объект не импортирован.' } }); }
  if (snapshot) {
    draft.data.sourceFetchedAt = new Date(snapshot.snapshotDate);
    draft.warnings.push(`Используется сохранённая выгрузка CRM от ${snapshot.snapshotDate}. Проверьте цены и наличие перед публикацией.`);
  }
  if (preferred) {
    // Revalidate the duplicate before saving either source's aliases.
    const { sources } = await prepareNmarketImport(config, preferred.id, input.complexId, saved,
      { sourceId, apartmentKey: preferred.key, identity: preferred.identity });
    draft.warnings.push('Квартира также найдена в Нмаркете. Создана одна карточка с данными CRM RF39.');
    return importProperty(draft, input.complexId, true, sources.reverse(), execution);
  }
  return importProperty(draft, input.complexId, true, undefined, execution);
}
