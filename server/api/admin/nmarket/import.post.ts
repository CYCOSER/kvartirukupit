import { z } from 'zod';
import { existingImportedProperty } from '../../../utils/import-property';
import { importNmarketProperty } from '../../../utils/import-nmarket';

export default defineEventHandler(async (event) => {
  const body = z.object({ id: z.string().regex(/^(?:apartment|complex):\d{1,20}$/), snapshot: z.literal('saved').optional(),
    complexId: z.string().trim().min(1).max(100).optional() }).strict().safeParse(await readBody(event));
  if (!body.success) throw createError({ statusCode: 400, data: { message: 'Выберите объект НМаркет.' } });
  const existing = await existingImportedProperty(`nmarket:${body.data.id}`, body.data.complexId);
  if (existing) return existing;
  const config = useRuntimeConfig(event);
  return importNmarketProperty(config, body.data.id, body.data.complexId, body.data.snapshot === 'saved');
});
