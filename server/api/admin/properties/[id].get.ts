import { relatedApartmentSelect, propertyFeatureSelect } from '../../../utils/property-relations';
export default defineEventHandler(async (event) => {
  const item = await db.property.findUnique({
    where: { id: getRouterParam(event, 'id') },
    include: {
      images: { orderBy: { order: 'asc' } },
      features: propertyFeatureSelect,
      complex: { select: { id: true, title: true, slug: true, published: true, features: propertyFeatureSelect, featureOverrides: true } },
      apartments: { select: relatedApartmentSelect, orderBy: { updatedAt: 'desc' } },
    },
  });
  if (!item) throw createError({ statusCode: 404, statusMessage: 'Not found' });
  return item;
});
