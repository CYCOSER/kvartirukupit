import { withPublicTitle } from '../../../shared/property';
import { publicComplexSelect } from '../../utils/property-relations';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  const selected = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Property"
    WHERE published = true AND status = 'available' AND elite = false
    ORDER BY random() LIMIT 10
  `;
  const items = await db.property.findMany({
    where: {
      id: { in: selected.map(({ id }) => id) },
      published: true,
      elite: false,
      status: 'available',
    },
    include: { images: { orderBy: { order: 'asc' } }, complex: publicComplexSelect },
  });
  return {
    items: selected.flatMap(({ id }) => items.find((p) => p.id === id) || []).map(withPublicTitle),
  };
});
