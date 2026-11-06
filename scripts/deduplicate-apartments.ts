import { db } from '../server/utils/db';
import { deduplicateApartmentLayout, importedApartments, type LayoutSourceOffer } from '../server/utils/apartment-layout-cleanup';
import { fetchNmarketSnapshot } from '../server/utils/nmarket';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--apply')) throw new Error('Использование: npm run apartments:dedupe -- [--apply]');
const apply = args.includes('--apply'), offers = new Map<string, LayoutSourceOffer>(), seen = new Set<string>();
const total = { scanned: 0, duplicates: 0, merged: 0, warnings: 0 };
let cursor: string | undefined;
try {
  try {
    const snapshot = await fetchNmarketSnapshot(process.env.NUXT_NMARKET_SNAPSHOT_PATH || '.data/nmarket/snapshot.xml');
    for (const item of snapshot.items) if (item.type === 'apartment' && item.supported)
      offers.set(`nmarket:${item.id}`, { price: item.price, availableFloors: item.floor == null ? [] : [item.floor] });
  } catch {
    console.warn('Сохранённая выгрузка НМаркет недоступна; используются только ранее сохранённые этажи квартир.');
    total.warnings++;
  }
  for (;;) {
    const properties = await db.property.findMany({ where: { ...importedApartments, ...(cursor ? { id: { gt: cursor } } : {}) },
      select: { id: true }, orderBy: { id: 'asc' }, take: 100 });
    if (!properties.length) break;
    for (const property of properties) {
      if (seen.has(property.id)) continue;
      const result = await deduplicateApartmentLayout(property.id, apply, offers);
      seen.add(property.id); seen.add(result.keeperId);
      result.duplicateIds.forEach(id => seen.add(id));
      total.scanned++;
      total.duplicates += result.duplicateIds.length;
      total.merged += result.merged;
      total.warnings += result.warnings.length;
      if (result.duplicateIds.length || result.warnings.length) console.log(JSON.stringify(result));
    }
    cursor = properties.at(-1)!.id;
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...total }));
} finally { await db.$disconnect(); }
