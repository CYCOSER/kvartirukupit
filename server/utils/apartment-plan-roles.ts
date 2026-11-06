import type { Prisma } from '@prisma/client';
import { db } from './db';
import { fetchNmarketSnapshot } from './nmarket';
import type { NmarketObject } from './nmarket-data';
import { lockPropertyRelations } from './property-relations';

export type PlanRoleOverrides = Map<string, { role: 'unit' | 'floor' | null; originalFile: string }>;
export const planRoleSelect = {
  id: true, sourceId: true, importSources: { select: { sourceId: true } },
  images: { select: { id: true, kind: true, file: true, originalFile: true, planRole: true } },
} satisfies Prisma.PropertySelect;
type RoleProperty = Prisma.PropertyGetPayload<{ select: typeof planRoleSelect }>;

export async function resolveNmarketPlanRoles(properties: RoleProperty[], items: NmarketObject[],
  client: Pick<Prisma.TransactionClient, 'importImageCache'> = db): Promise<PlanRoleOverrides> {
  const sourceIds = new Set(properties.flatMap(property => [property.sourceId, ...property.importSources.map(source => source.sourceId)]));
  const offers = items.filter(item => item.type === 'apartment' && item.supported && sourceIds.has(`nmarket:${item.id}`));
  const urls = [...new Set(offers.flatMap(item => item.images.filter(image => image.plan).map(image => image.url)))];
  const cache = new Map<string, { originalFile: string; planFile: string | null }>();
  for (let offset = 0; offset < urls.length; offset += 500) {
    const rows = await client.importImageCache.findMany({ where: { url: { in: urls.slice(offset, offset + 500) } },
      select: { url: true, originalFile: true, planFile: true } });
    for (const row of rows) cache.set(row.url, row);
  }
  const bySource = new Map(offers.map(item => [`nmarket:${item.id}`, item.images.filter(image => image.plan)]));
  const result: PlanRoleOverrides = new Map();
  for (const property of properties) {
    const roles = new Map<string, 'unit' | 'floor' | null>();
    for (const sourceId of new Set([property.sourceId, ...property.importSources.map(source => source.sourceId)])) {
      for (const image of sourceId && bySource.get(sourceId) || []) {
        const cached = cache.get(image.url);
        if (!cached) continue;
        const role = image.planRole || null;
        for (const file of [cached.originalFile, cached.planFile].filter((file): file is string => !!file))
          roles.set(file, !roles.has(file) || roles.get(file) === role ? role : null);
      }
    }
    for (const image of property.images) {
      if (image.kind !== 'plan' || image.planRole !== null) continue;
      const file = image.originalFile || image.file;
      if (roles.has(file)) result.set(image.id, { role: roles.get(file)!, originalFile: file });
    }
  }
  return result;
}

let warnedSnapshot = false;
export async function backfillNmarketPlanRoles(scope: Prisma.PropertyWhereInput) {
  const properties = await db.property.findMany({ where: { AND: [scope],
    OR: [{ sourceId: { startsWith: 'nmarket:' } }, { importSources: { some: { sourceId: { startsWith: 'nmarket:' } } } }],
    images: { some: { kind: 'plan', planRole: null } } }, select: planRoleSelect });
  if (!properties.length) return;
  let items: NmarketObject[];
  try { ({ items } = await fetchNmarketSnapshot(process.env.NUXT_NMARKET_SNAPSHOT_PATH || '.data/nmarket/snapshot.xml')); }
  catch (error) {
    if (![502, 503].includes((error as { statusCode?: number }).statusCode || 0)) throw error;
    if (!warnedSnapshot) console.warn('[apartment-layout] Saved NMarket XML unavailable; legacy plan roles remain unchanged.');
    warnedSnapshot = true;
    return;
  }
  const roles = await resolveNmarketPlanRoles(properties, items);
  if (![...roles.values()].some(value => value.role)) return;
  await db.$transaction(async tx => {
    await lockPropertyRelations(tx);
    for (const property of properties) {
      let changed = false;
      for (const image of property.images) {
        const planRole = roles.get(image.id)?.role;
        if (!planRole) continue;
        const updated = await tx.propertyImage.updateMany({ where: { id: image.id, propertyId: property.id,
          kind: 'plan', planRole: null, file: image.file, originalFile: image.originalFile }, data: { planRole } });
        changed ||= updated.count > 0;
      }
      // The empty hash deliberately marks an incomplete import and must remain incomplete.
      if (changed) await tx.property.updateMany({ where: { id: property.id, layoutHash: { not: '' } }, data: { layoutHash: null } });
    }
  }, { timeout: 30000 });
}
