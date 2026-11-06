import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { propertyImageFingerprint } from './image-fingerprint';
import { lockPropertyRelations } from './property-relations';
import { saveImportSources } from './import-sources';

type LayoutProperty = {
  type: string; housingMarket?: string | null; complexId?: string | null;
  nmarketComplexId?: string | null; rf39ComplexId?: string | null; rf39BuildingId?: string | null;
};
type LayoutImage = { kind?: string; file: string; originalFile?: string | null };

export function sameApartmentLayoutScope(left: LayoutProperty, right: LayoutProperty) {
  if (left.type !== 'apartment' || right.type !== 'apartment' || left.housingMarket !== 'newbuild' || right.housingMarket !== 'newbuild') return false;
  if (left.complexId && right.complexId) return left.complexId === right.complexId;
  return (['nmarketComplexId', 'rf39ComplexId', 'rf39BuildingId'] as const).some(key => !!left[key] && left[key] === right[key]);
}

export function layoutScopeWhere(data: LayoutProperty, complexId?: string): Prisma.PropertyWhereInput | null {
  if (data.type !== 'apartment' || data.housingMarket !== 'newbuild') return null;
  const external = ['nmarketComplexId', 'rf39ComplexId', 'rf39BuildingId']
    .filter(key => data[key as keyof LayoutProperty])
    .map(key => ({ [key]: data[key as keyof LayoutProperty] }));
  const local = complexId || data.complexId;
  if (!local && !external.length) return null;
  const scope = local ? { OR: [{ complexId: local }, ...(external.length ? [{ complexId: null, OR: external }] : [])] }
    : { OR: external };
  return { type: 'apartment', housingMarket: 'newbuild', sourceId: { not: null }, AND: [scope] };
}

export async function prepareApartmentLayout(data: LayoutProperty, images: LayoutImage[],
  client: Pick<Prisma.TransactionClient, 'imageFingerprint'> = db): Promise<string | null> {
  if (data.type !== 'apartment' || data.housingMarket !== 'newbuild') return null;
  const files = [...new Set(images.filter(image => image.kind === 'plan').map(image => image.originalFile || image.file))];
  if (!files.length) return null;
  const hashes: string[] = [];
  for (const file of files) {
    try { hashes.push(await propertyImageFingerprint(file, undefined, client)); }
    catch (error) {
      if ((error as { statusCode?: number }).statusCode !== 400) throw error;
      console.warn('[apartment-layout] Cannot compare an incomplete set of plans', { file });
      return null;
    }
  }
  // Compare the complete set: a shared floor diagram alone does not identify an apartment layout.
  return createHash('sha256').update([...new Set(hashes)].sort().join('\n')).digest('hex');
}

export function mergeLayoutAvailability(properties: { price?: number | null; availableFloors?: number[] }[]) {
  const prices = properties.map(property => property.price).filter((price): price is number => typeof price === 'number' && price > 0);
  const availableFloors = [...new Set(properties.flatMap(property => property.availableFloors || []))]
    .filter(floor => Number.isInteger(floor) && floor >= 1 && floor <= 100).sort((a, b) => a - b);
  return { price: prices.length ? Math.min(...prices) : null, availableFloors };
}

export async function indexApartmentLayouts(data: LayoutProperty, complexId?: string) {
  const scope = layoutScopeWhere(data, complexId);
  if (!scope) return;
  const include = { images: { where: { kind: 'plan' }, select: { kind: true, file: true, originalFile: true } } } as const;
  const previous = await db.property.findMany({ where: { AND: [scope], layoutHash: null, images: { some: { kind: 'plan' } } }, include });
  for (const property of previous) {
    const layoutHash = await prepareApartmentLayout(property, property.images);
    if (!layoutHash) continue;
    await db.$transaction(async tx => {
      await lockPropertyRelations(tx);
      const current = await tx.property.findUnique({ where: { id: property.id }, include });
      if (!current || current.layoutHash || !current.sourceId) return;
      const hash = await prepareApartmentLayout(current, current.images, tx);
      if (!hash) return;
      // Legacy aliases have no offer values; retain the original card's price before it becomes a group minimum.
      await saveImportSources(tx, current.id, [{ sourceId: current.sourceId }], current);
      await tx.property.update({ where: { id: current.id }, data: { layoutHash: hash } });
    }, { timeout: 30000 });
  }
}

export async function findApartmentLayout(tx: Prisma.TransactionClient, data: LayoutProperty, layoutHash: string, complexId?: string) {
  const scope = layoutScopeWhere(data, complexId);
  if (!scope) return null;
  const matches = await tx.property.findMany({ where: { AND: [scope], layoutHash }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  if (new Set(matches.map(property => property.complexId).filter(Boolean)).size > 1) return null;
  return matches[0] || null;
}
