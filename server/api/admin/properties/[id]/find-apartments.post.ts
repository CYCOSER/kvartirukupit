import { z } from 'zod';
import { chooseExternalComplex, isBuildingCard, matchesLocalApartment, missingSourceMappings, numberedAddress, rf39ApartmentCandidate, sameNumberedAddress } from '../../../../utils/complex-matching';
import { lockPropertyRelations } from '../../../../utils/property-relations';
import { fetchNmarketObjects, fetchNmarketSnapshot } from '../../../../utils/nmarket';
import { fetchRf39Objects } from '../../../../utils/rf39';
import { fetchRf39Developments } from '../../../../utils/rf39-developments';
import { rf39IsComplex, rf39Supported } from '../../../../utils/rf39-data';
import { cacheApartmentMatches, matchNmarketApartments, nmarketApartmentKeys, rf39ApartmentIdentity } from '../../../../utils/apartment-matching';
import { rememberExistingImportSources } from '../../../../utils/import-sources';

export default defineEventHandler(async (event) => {
  const body = z.object({ source: z.enum(['local', 'nmarket', 'rf39']), snapshot: z.literal('saved').optional() }).strict().safeParse(await readBody(event));
  if (!body.success) throw createError({ statusCode: 400, data: { message: 'Выберите источник поиска квартир.' } });
  const id = getRouterParam(event, 'id')!;
  const target = await db.property.findUnique({ where: { id } });
  if (!target || target.type !== 'complex') throw createError({ statusCode: 400, data: { message: 'Поиск квартир доступен только для сохранённого ЖК.' } });
  const result = { candidates: [] as { id: string | number; layoutId?: number; preferredNmarketId?: string; matchedNmarketIds?: string[] }[], matchedBy: '', warnings: [] as string[] };

  if (body.data.source === 'local') return db.$transaction(async tx => {
    await lockPropertyRelations(tx);
    const current = await tx.property.findUnique({ where: { id } });
    if (!current || current.type !== 'complex') throw createError({ statusCode: 409, data: { message: 'Карточка ЖК изменилась. Обновите страницу.' } });
    const apartments = await tx.property.findMany({ where: { type: 'apartment' }, select: {
      id: true, type: true, title: true, location: true, address: true, sourceId: true, complexId: true,
      nmarketComplexId: true, rf39ComplexId: true, rf39BuildingId: true,
    } });
    const matches = apartments.filter(apartment => matchesLocalApartment(current, apartment));
    const unlinked = matches.filter(apartment => !apartment.complexId);
    const linked = unlinked.length ? (await tx.property.updateMany({
      where: { id: { in: unlinked.map(apartment => apartment.id) }, complexId: null, type: 'apartment' }, data: { complexId: id },
    })).count : 0;
    const conflicts = matches.filter(apartment => apartment.complexId && apartment.complexId !== id).length;
    return { ...result, matchedBy: 'ID ЖК/корпуса или точный адрес и город', count: matches.length, linked,
      existing: matches.filter(apartment => apartment.complexId === id).length, conflicts,
      warnings: conflicts ? [`${conflicts} квартир уже связаны с другим ЖК; их связи сохранены.`] : [] };
  });

  async function saveMappings(mapping: { nmarketComplexId?: string; rf39ComplexId?: string; rf39BuildingId?: string }) {
    await db.$transaction(async tx => {
      await lockPropertyRelations(tx);
      const current = await tx.property.findUnique({ where: { id } });
      const data = current?.type === 'complex' ? missingSourceMappings(target!, current, mapping) : null;
      if (!data)
        throw createError({ statusCode: 409, data: { message: 'Данные ЖК изменились во время поиска. Обновите карточку и повторите поиск.' } });
      if (Object.keys(data).length) await tx.property.update({ where: { id }, data });
    });
  }

  const config = useRuntimeConfig(event);
  if (body.data.source === 'nmarket') {
    const snapshot = body.data.snapshot === 'saved' ? await fetchNmarketSnapshot(config.nmarketSnapshotPath) : null;
    const objects = snapshot ? snapshot.items : await fetchNmarketObjects(config.nmarketFeedUrl, config.nmarketSnapshotPath);
    const sourceComplexId = target.sourceId?.match(/^nmarket:complex:(\d+)$/)?.[1];
    if (sourceComplexId && target.nmarketComplexId && sourceComplexId !== target.nmarketComplexId)
      return { ...result, warnings: ['ID НМаркет противоречит исходному ЖК карточки. Проверьте ID перед поиском.'] };
    const complexes = objects.filter(item => item.type === 'complex' && item.complexId).map(item => ({ ...item, id: item.complexId! }));
    const match = chooseExternalComplex(target, complexes, target.nmarketComplexId || sourceComplexId);
    result.matchedBy = match.matchedBy; result.warnings.push(...match.warnings);
    if (snapshot) result.warnings.push(`Используется сохранённая выгрузка от ${snapshot.snapshotDate}. Проверьте цены и наличие.`);
    if (match.item) {
      if (isBuildingCard(target) && !numberedAddress(target.address))
        result.warnings.push('Это карточка корпуса. Для поиска в НМаркет укажите точный адрес корпуса с номером дома; квартиры всего ЖК не привязаны.');
      else result.candidates = objects.filter(item => item.type === 'apartment' && item.supported && item.complexId === match.item!.id &&
        (!isBuildingCard(target) || sameNumberedAddress(target, item))).map(item => ({ id: item.id }));
      await saveMappings({ nmarketComplexId: match.item.id });
    }
    const keys = nmarketApartmentKeys(objects);
    await rememberExistingImportSources(result.candidates.map(candidate => ({ sourceId: `nmarket:${candidate.id}`, apartmentKey: keys.get(`nmarket:${candidate.id}`) })));
    return { ...result, count: result.candidates.length, ...(snapshot ? { snapshotDate: snapshot.snapshotDate } : {}) };
  }

  const parentId = target.sourceId?.match(/^rf39:(\d+)$/)?.[1];
  const parent = parentId ? (await fetchRf39Objects(config.rf39Token, 0, Number(parentId))).find(item => String(item.id) === parentId) : undefined;
  if (parent && !rf39IsComplex(parent)) return { ...result, warnings: ['Исходный объект CRM является квартирой. Проверьте тип и ID карточки ЖК.'] };
  if (parent && ((target.rf39ComplexId && parent.development?.id && target.rf39ComplexId !== String(parent.development.id)) ||
      (target.rf39BuildingId && parent.complex?.id && target.rf39BuildingId !== String(parent.complex.id))))
    return { ...result, warnings: ['ID ЖК или корпуса противоречит исходному объекту CRM. Проверьте связь перед поиском.'] };
  const developmentId = target.rf39ComplexId || (parent?.development?.id ? String(parent.development.id) : undefined);
  const buildingId = target.rf39BuildingId || (parent?.complex?.id ? String(parent.complex.id) : undefined);
  if (parentId && !parent && !buildingId)
    return { ...result, warnings: ['Исходный корпус недоступен в опубликованной выгрузке CRM. Укажите ID корпуса или проверьте публикацию в CRM.'] };
  const developments = parent && !developmentId ? [] : await fetchRf39Developments(config.rf39Token, developmentId);
  const match = chooseExternalComplex(target, developments, developmentId);
  result.matchedBy = parentId ? 'исходный корпус CRM' : match.matchedBy;
  result.warnings.push(...match.warnings);
  if (!match.item && !parent) return result;
  const items = new Map(parent ? [[parent.id, parent]] : []);
  const objectIds = match.item?.objectIds || [];
  // Development lists include archived/unpublished records; re-fetch through the eligibility filter.
  for (let offset = 0; offset < objectIds.length; offset += 100) {
    const ids = objectIds.slice(offset, offset + 100);
    for (const item of await fetchRf39Objects(config.rf39Token, 0, ids.join(',')))
      if (ids.includes(item.id)) items.set(item.id, item);
  }
  const building = isBuildingCard(target);
  let ambiguous = 0;
  for (const item of items.values()) {
    if (!rf39Supported(item) || (match.item && item.development?.id && item.development.id !== match.item.id)) continue;
    const sameParent = !!parentId && String(item.id) === parentId;
    const sameBuilding = buildingId && item.complex?.id && String(item.complex.id) === buildingId;
    const conflictingBuilding = buildingId && item.complex?.id && String(item.complex.id) !== buildingId;
    if (building && !sameParent && !sameBuilding && (conflictingBuilding || !sameNumberedAddress(target, { location: item.city || '', address: item.address || '' }))) continue;
    const layouts = Object.values(item.layouts || {});
    if (layouts.length) result.candidates.push(...layouts.map(layout => ({ id: item.id, layoutId: layout.id })));
    else if (rf39ApartmentCandidate(item)) result.candidates.push({ id: item.id });
    else if (!rf39IsComplex(item)) ambiguous++;
  }
  if (ambiguous) result.warnings.push(`${ambiguous} объектов CRM пропущено: нет характеристик отдельной квартиры, объект может быть корпусом.`);
  if (building && !buildingId && !parentId && !numberedAddress(target.address))
    result.warnings.push('Укажите ID корпуса CRM или точный адрес с номером дома: квартиры соседних корпусов не привязаны.');
  await saveMappings({ ...(match.item ? { rf39ComplexId: String(match.item.id) } : {}), ...(buildingId ? { rf39BuildingId: buildingId } : {}) });
  if (result.candidates.length) {
    // Use both complete building sets: equal street address and unit number alone can name different corpora.
    const nmarket = body.data.snapshot === 'saved' ? (await fetchNmarketSnapshot(config.nmarketSnapshotPath)).items : await fetchNmarketObjects(config.nmarketFeedUrl, config.nmarketSnapshotPath);
    const identities = [...items.values()].flatMap(item => [rf39ApartmentIdentity(item), ...Object.values(item.layouts || {}).map(layout => rf39ApartmentIdentity(item, layout.id))]);
    const matches = matchNmarketApartments(nmarket, identities);
    const nmarketKeys = nmarketApartmentKeys(nmarket);
    cacheApartmentMatches(id, body.data.snapshot === 'saved', matches);
    const sources = result.candidates.map(candidate => {
      const sourceId = candidate.layoutId == null ? `rf39:${candidate.id}` : `rf39-layout:${candidate.id}:${candidate.layoutId}`;
      const matched = matches.get(sourceId);
      if (matched) {
        candidate.preferredNmarketId = matched.id;
        candidate.matchedNmarketIds = [...nmarketKeys].filter(([, key]) => key === matched.key).map(([sourceId]) => sourceId.slice('nmarket:'.length));
      }
      return { sourceId, apartmentKey: matched?.key };
    });
    await rememberExistingImportSources(sources);
    const unmatched = result.candidates.filter(candidate => !candidate.preferredNmarketId).length;
    if (unmatched) result.warnings.push(`Для ${unmatched} квартир нет однозначного совпадения с Нмаркетом по корпусу и номеру квартиры. Они обрабатываются отдельно; совпадение цены, площади и комнат не считается дублем.`);
  }
  return { ...result, count: result.candidates.length };
});
