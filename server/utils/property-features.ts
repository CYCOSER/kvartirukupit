import type { Prisma } from '@prisma/client';
import { createError } from 'h3';
import type { PropertyInput } from '../../shared/property';
import { validateFeatureSelection, type PropertyFeature } from '../../shared/property-feature';

export async function validatePropertyFeatureSelection(
  tx: Prisma.TransactionClient,
  data: Pick<PropertyInput, 'featureIds' | 'featureOverrides'>,
  previous?: { features: PropertyFeature[]; featureOverrides: NonNullable<PropertyInput['featureOverrides']> },
) {
  const ids = data.featureIds ?? previous?.features.map(feature => feature.id) ?? [];
  const features = await tx.propertyFeature.findMany({ where: { id: { in: ids } } });
  if (features.length !== ids.length)
    throw createError({ statusCode: 400, data: { message: 'Некоторые значки удалены. Обновите страницу и повторите выбор.' } });
  const message = validateFeatureSelection(features, data.featureOverrides ?? previous?.featureOverrides ?? []);
  if (message) throw createError({ statusCode: 400, data: { message } });
}
