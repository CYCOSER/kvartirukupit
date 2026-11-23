import { propertySchema } from '~/shared/property';
import { lockPropertyRelations, validatePropertyRelation, propertyFeatureSelect } from '../../../utils/property-relations';
import { validatePropertyFeatureSelection } from '../../../utils/property-features';
export default defineEventHandler(async (event) => {
  const parsed = propertySchema.safeParse(await readBody(event));
  if (!parsed.success)
    throw createError({ statusCode: 400, statusMessage: 'Invalid property' });
  if (await db.property.findUnique({ where: { slug: parsed.data.slug } }))
    throw createError({
      statusCode: 409,
      statusMessage: 'Slug already exists',
    });
  return db.$transaction(async (tx) => {
    await lockPropertyRelations(tx);
    await validatePropertyRelation(tx, parsed.data);
    await validatePropertyFeatureSelection(tx, parsed.data);
    const { featureIds, ...data } = parsed.data;
    return tx.property.create({
      data: { ...data, features: { connect: (featureIds ?? []).map(id => ({ id })) } },
      include: { images: true, features: propertyFeatureSelect },
    });
  });
});
