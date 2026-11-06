import type { Prisma } from '@prisma/client';
import { db } from './db';
import { layoutScopeWhere, mergeLayoutAvailability, prepareApartmentLayout, sameApartmentLayout, sameApartmentLayoutScope } from './apartment-layout';
import { propertyImageFingerprint, propertyPhotoFingerprint, samePhoto, type PhotoFingerprint } from './image-fingerprint';
import { lockPropertyRelations } from './property-relations';
import type { PlanRoleOverrides } from './apartment-plan-roles';

export const importedApartments = {
  type: 'apartment', OR: [
    { sourceId: { startsWith: 'nmarket:' } }, { sourceId: { startsWith: 'rf39:' } }, { sourceId: { startsWith: 'rf39-layout:' } },
  ],
} satisfies Prisma.PropertyWhereInput;
const include = { images: { orderBy: [{ order: 'asc' }, { id: 'asc' }] }, importSources: true } satisfies Prisma.PropertyInclude;
export type LayoutSourceOffer = { price?: number | null; availableFloors?: number[] };

export async function deduplicateApartmentLayout(propertyId: string, apply = false, sourceOffers = new Map<string, LayoutSourceOffer>(),
  planRoles: PlanRoleOverrides = new Map()) {
  const withRoles = <T extends { images: { id: string; file: string; originalFile: string | null; planRole: string | null }[] }>(property: T): T => {
    for (const image of property.images) {
      const override = planRoles.get(image.id);
      if (image.planRole === null && override?.originalFile === (image.originalFile || image.file)) image.planRole = override.role;
    }
    return property;
  };
  const warnings = new Set<string>();
  const empty = () => ({ keeperId: propertyId, duplicateIds: [] as string[], merged: 0,
    price: null as number | null, availableFloors: [] as number[], warnings: [...warnings] });
  const initial = await db.property.findFirst({ where: { id: propertyId, ...importedApartments }, include });
  if (!initial) return empty();
  const scope = layoutScopeWhere(initial, initial.complexId || undefined);
  if (!scope) return empty();
  const externalScope = layoutScopeWhere({ ...initial, complexId: null });
  const where = { AND: [importedApartments, { OR: [scope, ...(externalScope ? [externalScope] : [])] }] };
  const warm = await db.property.findMany({ where, include });
  for (const property of warm) {
    withRoles(property);
    if (!sameApartmentLayoutScope(initial, property) && !sameApartmentLayoutScope({ ...initial, complexId: null }, property)) continue;
    await prepareApartmentLayout(property, property.images);
    for (const image of property.images) {
      try {
        await propertyImageFingerprint(image.file);
        if (image.kind === 'photo' && !image.crop && !image.hueShift) await propertyPhotoFingerprint(image.file);
      }
      catch (error) { if ((error as { statusCode?: number }).statusCode !== 400) throw error; }
    }
  }
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async tx => {
        await lockPropertyRelations(tx);
        const current = await tx.property.findFirst({ where: { id: propertyId, ...importedApartments } });
        if (!current) return empty();
        const currentScope = layoutScopeWhere(current, current.complexId || undefined);
        if (!currentScope) return empty();
        const externalScope = layoutScopeWhere({ ...current, complexId: null });
        const allScope = { AND: [importedApartments, { OR: [currentScope, ...(externalScope ? [externalScope] : [])] }] };
        const ids = (await tx.property.findMany({ where: allScope, select: {
          id: true, type: true, housingMarket: true, complexId: true, location: true, address: true,
          nmarketComplexId: true, rf39ComplexId: true, rf39BuildingId: true,
        } })).filter(property => sameApartmentLayoutScope(current, property) || sameApartmentLayoutScope({ ...current, complexId: null }, property))
          .map(property => property.id).sort();
        // Upload locks precede row locks so an upload's foreign key cannot deadlock with deletion.
        for (const id of ids) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
        await tx.$queryRaw`SELECT "id" FROM "Property" WHERE "id" = ANY(${ids}::text[]) ORDER BY "id" FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "PropertyImage" WHERE "propertyId" = ANY(${ids}::text[]) ORDER BY "id" FOR UPDATE`;
        const seed = await tx.property.findFirst({ where: { id: propertyId, ...importedApartments }, include });
        if (!seed) return empty();
        withRoles(seed);
        const hash = await prepareApartmentLayout(seed, seed.images, tx);
        if (!hash) return empty();
        const candidates = await tx.property.findMany({ where: { AND: [importedApartments, currentScope, { id: { in: ids } }] },
          include, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
        const group: typeof candidates = [];
        for (const property of candidates) {
          withRoles(property);
          if (sameApartmentLayoutScope(seed, property) && await sameApartmentLayout(seed, seed.images, property, property.images, tx)) group.push(property);
        }
        const keeper = group[0];
        if (!keeper) return empty();
        // Approximate rendering matches are not transitive; every member must match the plan we keep.
        for (let i = group.length - 1; i > 0; i--)
          if (!await sameApartmentLayout(keeper, keeper.images, group[i]!, group[i]!.images, tx)) group.splice(i, 1);
        const complexIds = [...new Set(group.map(property => property.complexId).filter((id): id is string => !!id))];
        if (complexIds.length > 1) {
          warnings.add('Одинаковые планировки связаны с разными карточками ЖК; объединение пропущено.');
          return empty();
        }
        if (externalScope && complexIds.length && group.some(property => !property.complexId)) {
          const otherLinks = await tx.property.findMany({ where: { AND: [importedApartments, externalScope,
            { complexId: { not: null, notIn: complexIds } }] }, include });
          for (const property of otherLinks) if (await sameApartmentLayout({ ...seed, complexId: null }, seed.images, withRoles(property), property.images, tx)) {
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
        const unique: { key: string; image: (typeof keeper.images)[number]; photo: PhotoFingerprint | null }[] = [];
        for (const property of group) for (const image of property.images) {
          // Matching complete unit sets are represented by the oldest card's plans; all floor diagrams remain eligible.
          if (property.id !== keeper.id && image.kind === 'plan' && image.planRole === 'unit' &&
            keeper.images.some(candidate => candidate.kind === 'plan' && candidate.planRole === 'unit')) continue;
          let key: string, photo: PhotoFingerprint | null = null;
          try {
            key = await propertyImageFingerprint(image.file, undefined, tx);
            if (image.kind === 'photo' && !image.crop && !image.hueShift) photo = await propertyPhotoFingerprint(image.file, tx);
          }
          catch (error) {
            if ((error as { statusCode?: number }).statusCode !== 400) throw error;
            key = `file:${image.file}`;
            warnings.add(`Файл ${image.file} не удалось проверить; запись изображения сохранена.`);
          }
          const previous = unique.find(entry => entry.key === key || samePhoto(entry.photo, photo));
          if (!previous) unique.push({ key, image, photo });
          else if (previous.image.kind !== 'plan' && image.kind === 'plan') { previous.image = image; previous.photo = null; }
        }
        if (unique.length > 100) {
          warnings.add('Объединённая галерея превышает 100 изображений; карточки сохранены отдельно.');
          return empty();
        }
        if (apply) {
          for (const property of group) for (const image of property.images) if (planRoles.get(image.id)?.originalFile === (image.originalFile || image.file))
            await tx.propertyImage.update({ where: { id: image.id }, data: { planRole: image.planRole } });
          const mappings: Record<string, string> = {};
          for (const field of ['nmarketComplexId', 'rf39ComplexId', 'rf39BuildingId'] as const) {
            const values = [...new Set(group.map(property => property[field]).filter((value): value is string => !!value))];
            if (!keeper[field] && values.length === 1) mappings[field] = values[0]!;
          }
          await tx.property.update({ where: { id: keeper.id }, data: { ...availability, ...mappings,
            layoutHash: await prepareApartmentLayout(keeper, keeper.images, tx), complexId: keeper.complexId || complexIds[0] || null,
            ...(duplicateIds.length ? { priceKind: 'from' } : {}) } });
          if (duplicateIds.length)
            await tx.propertyImportSource.updateMany({ where: { propertyId: { in: duplicateIds } }, data: { propertyId: keeper.id } });
          for (const [sourceId, availability] of sources) await tx.propertyImportSource.upsert({ where: { sourceId },
            create: { sourceId, propertyId: keeper.id, ...availability }, update: availability });
          if (duplicateIds.length) {
            await tx.lead.updateMany({ where: { propertyId: { in: duplicateIds } }, data: { propertyId: keeper.id } });
            const tags = await tx.tagRelation.findMany({ where: { propertyId: { in: duplicateIds } }, select: { tagId: true } });
            if (tags.length) await tx.tagRelation.createMany({ data: tags.map(({ tagId }) => ({ tagId, propertyId: keeper.id })), skipDuplicates: true });
            let order = 0;
            for (const { image } of unique) await tx.propertyImage.update({ where: { id: image.id }, data: { propertyId: keeper.id, order: order++ } });
            await tx.propertyImage.deleteMany({ where: { propertyId: keeper.id, id: { notIn: unique.map(({ image }) => image.id) } } });
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
