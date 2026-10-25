import type { Prisma } from '@prisma/client';
import { createError } from 'h3';
import type { PropertyInput } from '../../shared/property';

export const publicComplexSelect = {
  where: { published: true },
  select: { id: true, title: true, slug: true, published: true },
};

export const relatedApartmentSelect = {
  id: true, title: true, slug: true, type: true, sourceMode: true, published: true,
  price: true, area: true, bedrooms: true, status: true,
  images: { orderBy: { order: 'asc' as const }, take: 1 },
} satisfies Prisma.PropertySelect;

export async function lockPropertyRelations(tx: Prisma.TransactionClient) {
  // The same lock protects a complex type change and apartments linked in another request.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('property-complex-relations'))`;
}

export async function validatePropertyRelation(
  tx: Prisma.TransactionClient,
  data: PropertyInput,
  existing?: { id: string; complexId: string | null },
) {
  const complexId = data.complexId === undefined ? existing?.complexId : data.complexId;
  if (complexId) {
    if (data.type !== 'apartment' || complexId === existing?.id)
      throw createError({ statusCode: 400, message: 'К жилому комплексу можно привязать только квартиру.' });
    const complex = await tx.property.findUnique({ where: { id: complexId }, select: { type: true } });
    if (complex?.type !== 'complex')
      throw createError({ statusCode: 400, message: 'Выберите существующий жилой комплекс.' });
  }
  if (existing && data.type !== 'complex' && await tx.property.count({ where: { complexId: existing.id } }))
    throw createError({ statusCode: 400, message: 'Сначала отвяжите квартиры от этого жилого комплекса, затем измените тип.' });
}
