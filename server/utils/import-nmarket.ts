import { createError } from 'h3';
import { fetchNmarketObjects, fetchNmarketSnapshot } from './nmarket';
import { nmarketDraft } from './nmarket-data';
import { matchNmarketApartments, nmarketApartmentKeys, type ApartmentIdentity } from './apartment-matching';
import { importProperty } from './import-property';
import type { ImportSource } from './import-sources';

export async function prepareNmarketImport(config: { nmarketSnapshotPath: string; nmarketFeedUrl: string }, id: string,
  complexId?: string, saved = false, alias?: ImportSource & { identity: ApartmentIdentity }) {
  const snapshot = saved ? await fetchNmarketSnapshot(config.nmarketSnapshotPath) : null;
  const items = snapshot ? snapshot.items : await fetchNmarketObjects(config.nmarketFeedUrl, config.nmarketSnapshotPath);
  const item = items.find(item => item.id === id);
  if (!item) throw createError({ statusCode: 404, data: { message: 'Объект больше не доступен в выгрузке НМаркет.' } });
  const key = nmarketApartmentKeys(items).get(`nmarket:${id}`);
  if (alias && (!key || key !== alias.apartmentKey || matchNmarketApartments(items, [alias.identity]).get(alias.sourceId)?.key !== key))
    throw createError({ statusCode: 409, data: { message: 'Сведения о квартире или корпусе изменились. Повторите поиск квартир в ЖК; копия из CRM не создана.' } });
  let draft;
  try { draft = nmarketDraft(item, snapshot?.snapshotDate); }
  catch { throw createError({ statusCode: 422, data: { message: 'Данные объекта не подходят для карточки ЖК или квартиры. Объект не импортирован.' } }); }
  if (alias) draft.warnings.push('Квартира также найдена в CRM. Создана одна карточка с данными Нмаркета.');
  const sources = [
    { sourceId: draft.data.sourceId, apartmentKey: key },
    ...(alias ? [{ sourceId: alias.sourceId, apartmentKey: key }] : []),
  ];
  return { draft, sources };
}

export async function importNmarketProperty(...args: Parameters<typeof prepareNmarketImport>) {
  const { draft, sources } = await prepareNmarketImport(...args);
  return importProperty(draft, args[2], false, sources);
}
