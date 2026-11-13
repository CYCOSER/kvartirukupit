import type { Prisma } from '@prisma/client';
import { createError } from 'h3';
import { db } from './db';
import { lockPropertyRelations } from './property-relations';
import { rf39ManualBaseline } from '../../shared/rf39-feed-merge';

export const agentPropertySelect = {
  id: true, title: true, slug: true, type: true, location: true, address: true,
  description: true, published: true, updatedAt: true, complexId: true,
  housingMarket: true, price: true, area: true, bedrooms: true, floors: true,
  availableFloors: true, status: true, readiness: true, finish: true,
  seaDistance: true, utilities: true, developer: true, district: true,
  completionDate: true, constructionStatus: true,
} satisfies Prisma.PropertySelect;

export async function updateAgentPropertyDescription(id: string, description: string) {
  return db.$transaction(async (tx) => {
    await lockPropertyRelations(tx);
    const current = await tx.property.findUnique({ where: { id } });
    if (!current)
      throw createError({ statusCode: 404, statusMessage: 'Property not found' });
    return tx.property.update({
      where: { id },
      data: {
        description,
        ...(current.sourceId?.startsWith('rf39:') && current.description !== description
          ? { rf39Baseline: JSON.parse(JSON.stringify(rf39ManualBaseline(current.rf39Baseline, ['description']))) }
          : {}),
      },
      select: agentPropertySelect,
    });
  });
}
