import { publicComplexSelect, relatedApartmentSelect } from '../../utils/property-relations';
import { withPublicTitle } from '../../../shared/property';
export default defineEventHandler(async (event) => {
  const property = await db.property.findFirst({
    where: { slug: getRouterParam(event, 'slug'), published: true },
    omit: { rf39Baseline: true },
    include: {
      images: { orderBy: { order: 'asc' } },
      tagRelations: { select: { tag: { select: { name: true } } } },
      complex: {
        ...publicComplexSelect,
        select: {
          ...publicComplexSelect.select,
          images: { where: { kind: 'photo' }, orderBy: { order: 'asc' } },
        },
      },
      apartments: {
        where: { published: true },
        select: relatedApartmentSelect,
        orderBy: { price: 'asc' },
      },
    },
  });
  if (!property)
    throw createError({ statusCode: 404, statusMessage: 'Object not found' });
  const { images: complexImages = [], ...complex } = property.complex || {};
  const images = [...property.images];
  if (property.type === 'apartment') {
    const files = new Set(images.map(image => image.file));
    for (const image of complexImages) {
      if (files.has(image.file)) continue;
      files.add(image.file);
      images.push(image);
    }
  }
  return { ...withPublicTitle(property), images, complex: property.complex ? complex : null,
    apartments: property.apartments.map(withPublicTitle) };
});
