import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { z } from 'zod';
import { updateAgentPropertyDescription } from '../../../../../utils/agent-properties';

const descriptionSchema = z.object({ description: z.string().trim().max(30000) }).strict();

export default defineEventHandler(async (event) => {
  const parsed = descriptionSchema.safeParse(await readBody(event));
  if (!parsed.success)
    throw createError({ statusCode: 400, statusMessage: 'Invalid description', data: parsed.error.flatten() });
  return updateAgentPropertyDescription(getRouterParam(event, 'id')!, parsed.data.description);
});
