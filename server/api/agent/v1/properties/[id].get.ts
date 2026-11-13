import { createError, defineEventHandler, getRouterParam } from 'h3';
import { db } from '../../../../utils/db';
import { agentPropertySelect } from '../../../../utils/agent-properties';

export default defineEventHandler(async (event) => {
  const property = await db.property.findUnique({
    where: { id: getRouterParam(event, 'id') },
    select: agentPropertySelect,
  });
  if (!property)
    throw createError({ statusCode: 404, statusMessage: 'Property not found' });
  return property;
});
