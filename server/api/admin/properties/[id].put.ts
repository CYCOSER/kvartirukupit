import { propertySchema } from '~/shared/property';
import { lockPropertyRelations, validatePropertyRelation } from '../../../utils/property-relations';
export default defineEventHandler(async (event) => {
  const parsed = propertySchema.safeParse(await readBody(event));
  if (!parsed.success)
    throw createError({ statusCode: 400, statusMessage: 'Invalid property' });
  const id = getRouterParam(event, 'id')!;
  return db.$transaction(async (tx) => {
    await lockPropertyRelations(tx);
    const existing = await tx.property.findUnique({ where: { id } });
    if (!existing)
      throw createError({ statusCode: 404, statusMessage: 'Not found' });
    if (
      await tx.property.findFirst({
        where: { slug: parsed.data.slug, id: { not: id } },
      })
    )
      throw createError({
        statusCode: 409,
        statusMessage: 'Slug already exists',
      });
    await validatePropertyRelation(tx, parsed.data, existing);
    return tx.property.update({
      where: { id },
      data: parsed.data,
      include: { images: { orderBy: { order: 'asc' } } },
    });
  });
});
