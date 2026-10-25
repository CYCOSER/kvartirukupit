import { publicComplexSelect, relatedApartmentSelect } from '../../utils/property-relations';
import { withPublicTitle } from '../../../shared/property';
export default defineEventHandler(async (event) => {
  const property = await db.property.findFirst({
    where: { slug: getRouterParam(event, 'slug'), published: true },
    include: {
      images: { orderBy: { order: 'asc' } },
      complex: publicComplexSelect,
      apartments: {
        where: { published: true },
        select: relatedApartmentSelect,
        orderBy: { price: 'asc' },
      },
    },
  });
  if (!property)
    throw createError({ statusCode: 404, statusMessage: 'Object not found' });
  return { ...withPublicTitle(property), apartments: property.apartments.map(withPublicTitle) };
});
