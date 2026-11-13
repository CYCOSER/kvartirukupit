import { defineEventHandler, setHeader } from 'h3';
import { withPublicTitle } from '../../../shared/property';
import { db } from '../../utils/db';
import { publicComplexSelect } from '../../utils/property-relations';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const selected = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Property"
    WHERE published = true AND type = 'complex' AND status = 'available'
    ORDER BY priority DESC, random() LIMIT 10
  `;
  const items = await db.property.findMany({
    omit: { rf39Baseline: true },
    where: {
      id: { in: selected.map(({ id }) => id) },
      published: true,
      type: 'complex',
      status: 'available',
    },
    include: { images: { orderBy: { order: 'asc' } }, complex: publicComplexSelect },
  });
  return {
    items: selected.flatMap(({ id }) => items.find((p) => p.id === id) || []).map(withPublicTitle),
  };
});
