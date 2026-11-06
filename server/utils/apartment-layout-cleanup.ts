import type { Prisma } from '@prisma/client';
import { db } from './db';
import { layoutScopeWhere, mergeLayoutAvailability, prepareApartmentLayout } from './apartment-layout';
import { propertyImageFingerprint } from './image-fingerprint';
import { lockPropertyRelations } from './property-relations';

export const importedNewbuilds = {
  type: 'apartment', housingMarket: 'newbuild', OR: [
    { sourceId: { startsWith: 'nmarket:' } }, { sourceId: { startsWith: 'rf39:' } }, { sourceId: { startsWith: 'rf39-layout:' } },
  ],
} satisfies Prisma.PropertyWhereInput;
const include = { images: { orderBy: [{ order: 'asc' }, { id: 'asc' }] }, importSources: true } satisfies Prisma.PropertyInclude;
export type LayoutSourceOffer = { price?: number | null; availableFloors?: number[] };

export async function deduplicateApartmentLayout(propertyId: string, apply = false, sourceOffers = new Map<string, LayoutSourceOffer>()) {
  const warnings = new Set<string>();
  const empty = () => ({ keeperId: propertyId, duplicateIds: [] as string[], merged: 0,
    price: null as number | null, availableFloors: [] as number[], warnings: [...warnings] });
  const initial = await db.property.findFirst({ where: { id: propertyId, ...importedNewbuilds }, include });
  if (!initial) return empty();
  const scope = layoutScopeWhere(initial, initial.complexId || undefined);
  if (!scope) return empty();
  const externalScope = layoutScopeWhere({ ...initial, complexId: null });
  const where = { AND: [importedNewbuilds, { OR: [scope, ...(externalScope ? [externalScope] : [])] }] };
  const warm = await db.property.findMany({ where, include });
  for (const property of warm) {
    await prepareApartmentLayout(property, property.images);
    for (const image of property.images) {
      try { await propertyImageFingerprint(image.file); }
      catch (error) { if ((error as { statusCode?: number }).statusCode !== 400) throw error; }
    }
  }
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async tx => {
        await lockPropertyRelations(tx);
        const current = await tx.property.findFirst({ where: { id: propertyId, ...importedNewbuilds } });
        if (!current) return empty();
        const currentScope = layoutScopeWhere(current, current.complexId || undefined);
        if (!currentScope) return empty();
        const externalScope = layoutScopeWhere({ ...current, complexId: null });
        const allScope = { AND: [importedNewbuilds, { OR: [currentScope, ...(externalScope ? [externalScope] : [])] }] };
        const ids = (await tx.property.findMany({ where: allScope, select: { id: true } })).map(property => property.id).sort();
        // Upload locks precede row locks so an upload's foreign key cannot deadlock with deletion.
        for (const id of ids) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
        await tx.$queryRaw`SELECT "id" FROM "Property" WHERE "id" = ANY(${ids}::text[]) ORDER BY "id" FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "PropertyImage" WHERE "propertyId" = ANY(${ids}::text[]) ORDER BY "id" FOR UPDATE`;
        const seed = await tx.property.findFirst({ where: { id: propertyId, ...importedNewbuilds }, include });
        if (!seed) return empty();
        const hash = await prepareApartmentLayout(seed, seed.images, tx);
        if (!hash) return empty();
        const candidates = await tx.property.findMany({ where: { AND: [importedNewbuilds, currentScope, { id: { in: ids } }] },
          include, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
        const group: typeof candidates = [];
        for (const property of candidates) {
          if (await prepareApartmentLayout(property, property.images, tx) === hash) group.push(property);
        }
        const keeper = group[0];
        if (!keeper) return empty();
        const complexIds = [...new Set(group.map(property => property.complexId).filter((id): id is string => !!id))];
        if (complexIds.length > 1) {
          warnings.add('Одинаковые планировки связаны с разными карточками ЖК; объединение пропущено.');
          return empty();
        }
        if (externalScope && complexIds.length && group.some(property => !property.complexId)) {
          const otherLinks = await tx.property.findMany({ where: { AND: [importedNewbuilds, externalScope,
            { complexId: { not: null, notIn: complexIds } }] }, include });
          for (const property of otherLinks) if (await prepareApartmentLayout(property, property.images, tx) === hash) {
            warnings.add('Непривязанная квартира подходит к разным карточкам ЖК; объединение пропущено.');
            return empty();
          }
        }
        const groupIds = group.map(property => property.id), duplicateIds = groupIds.slice(1);
        const primaryIds = group.map(property => property.sourceId!).filter(Boolean);
        const ownAliases = group.flatMap(property => property.importSources);
        const keys = [...new Set(ownAliases.map(source => source.apartmentKey).filter((key): key is string => !!key))];
        const conflicting = await tx.propertyImportSource.findMany({ where: { propertyId: { notIn: groupIds },
          OR: [{ sourceId: { in: primaryIds } }, ...(keys.length ? [{ apartmentKey: { in: keys } }] : [])] }, select: { sourceId: true } });
        if (conflicting.length) {
          warnings.add('Источники квартир связаны с другими карточками; объединение пропущено.');
          return empty();
        }
        const sources = new Map<string, ReturnType<typeof mergeLayoutAvailability>>();
        for (const property of group) {
          const ids = new Set([property.sourceId!, ...property.importSources.map(source => source.sourceId)]);
          for (const sourceId of ids) {
            const existing = property.importSources.find(source => source.sourceId === sourceId), offer = sourceOffers.get(sourceId);
            const knownFloors = [...(existing?.availableFloors || []), ...(offer?.availableFloors || [])];
            sources.set(sourceId, mergeLayoutAvailability([{ price: existing?.price ?? offer?.price ??
              (sourceId === property.sourceId ? property.price : null),
              availableFloors: knownFloors.length ? knownFloors : sourceId === property.sourceId ? property.availableFloors : [] }]));
          }
        }
        const availability = mergeLayoutAvailability([...group, ...sources.values()]);
        const unique = new Map<string, (typeof keeper.images)[number]>();
        for (const property of group) for (const image of property.images) {
          let key: string;
          try { key = await propertyImageFingerprint(image.file, undefined, tx); }
          catch (error) {
            if ((error as { statusCode?: number }).statusCode !== 400) throw error;
            key = `file:${image.file}`;
            warnings.add(`Файл ${image.file} не удалось проверить; запись изображения сохранена.`);
          }
          const previous = unique.get(key);
          if (!previous || previous.kind !== 'plan' && image.kind === 'plan') unique.set(key, image);
        }
        if (unique.size > 100) {
          warnings.add('Объединённая галерея превышает 100 изображений; карточки сохранены отдельно.');
          return empty();
        }
        if (apply) {
          const mappings: Record<string, string> = {};
          for (const field of ['nmarketComplexId', 'rf39ComplexId', 'rf39BuildingId'] as const) {
            const values = [...new Set(group.map(property => property[field]).filter((value): value is string => !!value))];
            if (!keeper[field] && values.length === 1) mappings[field] = values[0]!;
          }
          await tx.property.update({ where: { id: keeper.id }, data: { ...availability, ...mappings,
            layoutHash: hash, complexId: keeper.complexId || complexIds[0] || null,
            ...(duplicateIds.length ? { priceKind: 'from' } : {}) } });
          if (duplicateIds.length)
            await tx.propertyImportSource.updateMany({ where: { propertyId: { in: duplicateIds } }, data: { propertyId: keeper.id } });
          for (const [sourceId, availability] of sources) await tx.propertyImportSource.upsert({ where: { sourceId },
            create: { sourceId, propertyId: keeper.id, ...availability }, update: availability });
          if (duplicateIds.length) {
            await tx.lead.updateMany({ where: { propertyId: { in: duplicateIds } }, data: { propertyId: keeper.id } });
            let order = 0;
            for (const image of unique.values()) await tx.propertyImage.update({ where: { id: image.id }, data: { propertyId: keeper.id, order: order++ } });
            await tx.propertyImage.deleteMany({ where: { propertyId: keeper.id, id: { notIn: [...unique.values()].map(image => image.id) } } });
            await tx.property.deleteMany({ where: { id: { in: duplicateIds } } });
          }
        }
        return { keeperId: keeper.id, duplicateIds, merged: apply ? duplicateIds.length : 0,
          price: availability.price, availableFloors: availability.availableFloors, warnings: [...warnings] };
      }, { timeout: 60000 });
    } catch (error) {
      const failure = error as { code?: string; meta?: { code?: string } };
      if (attempt >= 2 || (failure.code !== 'P2034' && !['40P01', '40001'].includes(failure.meta?.code || ''))) throw error;
    }
  }
}
