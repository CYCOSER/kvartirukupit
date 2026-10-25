import { relatedApartmentSelect } from '../../../utils/property-relations';
export default defineEventHandler(async (event) => {
  const item = await db.property.findUnique({
    where: { id: getRouterParam(event, 'id') },
    include: {
      images: { orderBy: { order: 'asc' } },
      complex: { select: { id: true, title: true, slug: true, published: true } },
      apartments: { select: relatedApartmentSelect, orderBy: { updatedAt: 'desc' } },
    },
  });
  if (!item) throw createError({ statusCode: 404, statusMessage: 'Not found' });
  return item;
});
