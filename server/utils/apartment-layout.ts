import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { propertyImageFingerprint } from './image-fingerprint';
import { lockPropertyRelations } from './property-relations';
import { saveImportSources } from './import-sources';
import { apartmentAddress } from './apartment-matching';

type LayoutProperty = {
  type: string; housingMarket?: string | null; complexId?: string | null;
  nmarketComplexId?: string | null; rf39ComplexId?: string | null; rf39BuildingId?: string | null;
  location?: string | null; address?: string | null;
  layoutHash?: string | null; sourceNote?: string | null;
};
type LayoutImage = { kind?: string; file: string; originalFile?: string | null };
const externalIds = ['nmarketComplexId', 'rf39ComplexId', 'rf39BuildingId'] as const;
function unlinkedAddress(data: LayoutProperty) {
  const address = apartmentAddress(data.location || '', data.address || '');
  return address.startsWith('уточняется|') ? '' : address;
}

export function sameApartmentLayoutScope(left: LayoutProperty, right: LayoutProperty) {
  if (left.type !== 'apartment' || right.type !== 'apartment' || left.housingMarket !== right.housingMarket) return false;
  if (left.housingMarket === 'newbuild' && (left.complexId || right.complexId || externalIds.some(key => left[key] || right[key]))) {
    if (left.complexId && right.complexId) return left.complexId === right.complexId;
    return externalIds.some(key => !!left[key] && left[key] === right[key]);
  }
  if (!['newbuild', 'secondary'].includes(left.housingMarket || '') || left.complexId || right.complexId) return false;
  if (externalIds.some(key => (left[key] || null) !== (right[key] || null))) return false;
  const address = unlinkedAddress(left);
  return !!address && address === unlinkedAddress(right);
}

export function layoutScopeWhere(data: LayoutProperty, complexId?: string): Prisma.PropertyWhereInput | null {
  if (data.type !== 'apartment' || !['newbuild', 'secondary'].includes(data.housingMarket || '')) return null;
  const external = externalIds.filter(key => data[key]).map(key => ({ [key]: data[key] }));
  const local = complexId || data.complexId;
  if (data.housingMarket === 'secondary' || !local && !external.length) {
    if (local || !unlinkedAddress(data)) return null;
    // The normalized address is checked by sameApartmentLayoutScope after the indexed hash lookup.
    return { type: 'apartment', housingMarket: data.housingMarket, sourceId: { not: null }, complexId: null,
      nmarketComplexId: data.nmarketComplexId || null, rf39ComplexId: data.rf39ComplexId || null, rf39BuildingId: data.rf39BuildingId || null };
  }
  const scope = local ? { OR: [{ complexId: local }, ...(external.length ? [{ complexId: null, OR: external }] : [])] }
    : { OR: external };
  return { type: 'apartment', housingMarket: 'newbuild', sourceId: { not: null }, AND: [scope] };
}

export async function prepareApartmentLayout(data: LayoutProperty, images: LayoutImage[],
  client: Pick<Prisma.TransactionClient, 'imageFingerprint'> = db): Promise<string | null> {
  // Empty hash marks an incomplete import; legacy cards recorded image failures only in their note.
  if (data.layoutHash === '' || data.layoutHash == null && /Не удалось загрузить (?:фотографию|планировку)|Некоторые адреса фотографий отклонены|только первые 100 фотографий/u.test(data.sourceNote || '')) return null;
  if (data.type !== 'apartment' || !['newbuild', 'secondary'].includes(data.housingMarket || '')) return null;
  const gallery = data.housingMarket === 'secondary';
  if (gallery && !layoutScopeWhere(data)) return null;
  const files = [...new Set(images.filter(image => gallery || image.kind === 'plan').map(image => image.originalFile || image.file))];
  if (!files.length) return null;
  const hashes: string[] = [];
  for (const file of files) {
    try { hashes.push(await propertyImageFingerprint(file, undefined, client)); }
    catch (error) {
      if ((error as { statusCode?: number }).statusCode !== 400) throw error;
      console.warn('[apartment-layout] Cannot compare an incomplete image set', { file });
      return null;
    }
  }
  // Compare the complete set: a shared floor diagram alone does not identify an apartment layout.
  return createHash('sha256').update((gallery ? 'photos-v1\n' : '') + [...new Set(hashes)].sort().join('\n')).digest('hex');
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
  const source = { ...data, complexId: complexId || data.complexId };
  const include = { images: { select: { kind: true, file: true, originalFile: true } } } as const;
  const previous = await db.property.findMany({ where: { AND: [scope], layoutHash: null,
    images: { some: data.housingMarket === 'newbuild' ? { kind: 'plan' } : {} } }, include });
  for (const property of previous) {
    if (!sameApartmentLayoutScope(source, property)) continue;
    const layoutHash = await prepareApartmentLayout(property, property.images);
    if (!layoutHash) continue;
    await db.$transaction(async tx => {
      await lockPropertyRelations(tx);
      const current = await tx.property.findUnique({ where: { id: property.id }, include });
      if (!current || current.layoutHash !== null || !current.sourceId || !sameApartmentLayoutScope(source, current)) return;
      const hash = await prepareApartmentLayout(current, current.images, tx);
      if (!hash) return;
      // Legacy aliases have no offer values; retain the original card's price before it becomes a group minimum.
      await saveImportSources(tx, current.id, [{ sourceId: current.sourceId }], current);
      await tx.property.update({ where: { id: current.id }, data: { layoutHash: hash } });
    }, { timeout: 30000 });
  }
}

export async function findApartmentLayout(tx: Prisma.TransactionClient, data: LayoutProperty, layoutHash: string, complexId?: string) {
  if (!layoutHash) return null;
  const scope = layoutScopeWhere(data, complexId);
  if (!scope) return null;
  const candidates = await tx.property.findMany({ where: { AND: [scope], layoutHash }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const matches = candidates.filter(property => sameApartmentLayoutScope({ ...data, complexId: complexId || data.complexId }, property));
  if (new Set(matches.map(property => property.complexId).filter(Boolean)).size > 1) return null;
  return matches[0] || null;
}
