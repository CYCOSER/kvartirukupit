import { parsePropertyUpdate, mergePropertyUpdate, propertyEditFields } from '~/shared/property-edit';
import { rf39ManualBaseline } from '~/shared/rf39-feed-merge';
import { lockPropertyRelations, validatePropertyRelation } from '../../../utils/property-relations';
export default defineEventHandler(async (event) => {
  let submitted: ReturnType<typeof parsePropertyUpdate>;
  try { submitted = parsePropertyUpdate(await readBody(event)); }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid property' });
  }
  const id = getRouterParam(event, 'id')!;
  return db.$transaction(async (tx) => {
    await lockPropertyRelations(tx);
    const existing = await tx.property.findUnique({ where: { id } });
    if (!existing)
      throw createError({ statusCode: 404, statusMessage: 'Not found' });
    let data: ReturnType<typeof mergePropertyUpdate>;
    try { data = mergePropertyUpdate(existing, submitted); }
    catch {
      throw createError({ statusCode: 409, data: { message: 'Объект изменился во время редактирования. Обновите страницу и проверьте связанные поля.' } });
    }
    if (
      await tx.property.findFirst({
        where: { slug: data.slug, id: { not: id } },
      })
    )
      throw createError({
        statusCode: 409,
        statusMessage: 'Slug already exists',
      });
    await validatePropertyRelation(tx, data, existing);
    const edited = propertyEditFields.filter(field => JSON.stringify(existing[field]) !== JSON.stringify(data[field]));
    return tx.property.update({
      where: { id },
      data: { ...data, ...(existing.sourceId?.startsWith('rf39:') && edited.length
        ? { rf39Baseline: JSON.parse(JSON.stringify(rf39ManualBaseline(existing.rf39Baseline, edited))) } : {}) },
      include: { images: { orderBy: { order: 'asc' } } },
    });
  });
});
