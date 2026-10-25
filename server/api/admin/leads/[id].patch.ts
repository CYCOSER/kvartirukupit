import { z } from 'zod';
export default defineEventHandler(async (event) => {
  const parsed = z
    .object({ status: z.enum(['new', 'in_progress', 'done']) })
    .safeParse(await readBody(event));
  if (!parsed.success)
    throw createError({ statusCode: 400, statusMessage: 'Invalid status' });
  return db.lead.update({
    where: { id: getRouterParam(event, 'id') },
    data: parsed.data,
  });
});
