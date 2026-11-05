import { db } from '../server/utils/db';
import { deduplicatePropertyImages } from '../server/utils/image-dedup';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--apply')) throw new Error('Использование: npm run images:dedupe -- [--apply]');
const apply = args.includes('--apply');
const total = { properties: 0, scanned: 0, duplicates: 0, deleted: 0, skippedFiles: 0 };
let cursor: string | undefined;
try {
  for (;;) {
    const properties = await db.property.findMany({
      where: { ...(cursor ? { id: { gt: cursor } } : {}), images: { some: {} } },
      select: { id: true }, orderBy: { id: 'asc' }, take: 100,
    });
    if (!properties.length) break;
    for (const property of properties) {
      const result = await deduplicatePropertyImages(property.id, apply);
      total.properties++;
      total.scanned += result.scanned;
      total.duplicates += result.duplicates;
      total.deleted += result.deleted;
      total.skippedFiles += result.warnings.length;
      if (result.duplicates || result.warnings.length) console.log(JSON.stringify({ propertyId: property.id, ...result }));
    }
    cursor = properties.at(-1)!.id;
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...total }));
} finally { await db.$disconnect(); }
