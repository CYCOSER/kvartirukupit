import { propertySchema } from '~/shared/property';
import { lockPropertyRelations, validatePropertyRelation } from '../../../utils/property-relations';
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
    return tx.property.create({ data: parsed.data, include: { images: true } });
  });
});
