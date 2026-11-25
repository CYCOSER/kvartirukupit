import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { z } from 'zod';
import { propertyFeatureGroupSchema } from '../../../../../../shared/property-feature';
import { agentPropertySelect } from '../../../../../utils/agent-properties';
import { db } from '../../../../../utils/db';
import { validatePropertyFeatureSelection } from '../../../../../utils/property-features';
import { lockPropertyRelations, propertyFeatureSelect } from '../../../../../utils/property-relations';
import { syncPropertyFeatureTags } from '../../../../../utils/tag-assignments';

const featuresSchema = z.object({
  featureIds: z.array(z.string().trim().min(1).max(100)).max(200)
    .transform(ids => [...new Set(ids)]).optional(),
  featureOverrides: z.array(propertyFeatureGroupSchema).max(4)
    .transform(groups => [...new Set(groups)]).optional(),
}).strict().refine(data => Object.keys(data).length > 0, { message: 'At least one field is required' });

export default defineEventHandler(async (event) => {
  const parsed = featuresSchema.safeParse(await readBody(event));
  if (!parsed.success)
    throw createError({ statusCode: 400, statusMessage: 'Invalid features', data: parsed.error.flatten() });
  const id = getRouterParam(event, 'id')!;
  return db.$transaction(async (tx) => {
    await lockPropertyRelations(tx);
    const current = await tx.property.findUnique({
      where: { id }, select: { features: propertyFeatureSelect, featureOverrides: true },
    });
    if (!current)
      throw createError({ statusCode: 404, statusMessage: 'Property not found' });
    await validatePropertyFeatureSelection(tx, parsed.data, current);
    const { featureIds, featureOverrides } = parsed.data;
    if (featureIds !== undefined)
      await syncPropertyFeatureTags(tx, id, featureIds);
    return tx.property.update({
      where: { id },
      data: {
        ...(featureIds !== undefined ? { features: { set: featureIds.map(id => ({ id })) } } : {}),
        ...(featureOverrides !== undefined ? { featureOverrides } : {}),
      },
      select: agentPropertySelect,
    });
  });
});
