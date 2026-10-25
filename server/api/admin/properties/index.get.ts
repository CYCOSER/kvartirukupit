export default defineEventHandler((event) => {
  const type = getQuery(event).type;
  if (type !== undefined && type !== 'complex' && type !== 'apartment')
    throw createError({ statusCode: 400, statusMessage: 'Invalid property type' });
  return db.property.findMany({
    where: type ? { type } : undefined,
    orderBy: { updatedAt: 'desc' },
    include: { images: { orderBy: { order: 'asc' } } },
  });
});
