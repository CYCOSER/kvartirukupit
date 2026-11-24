import { createError, defineEventHandler, readBody } from 'h3';
import { tagSchema } from '../../../../shared/tag';
import { createTagDefinition } from '../../../utils/tag-definitions';

export default defineEventHandler(async event => {
  const parsed = tagSchema.safeParse(await readBody(event));
  if (!parsed.success) throw createError({ statusCode: 400, data: { message: 'Укажите название тега и корректные параметры значка.' } });
  return createTagDefinition(parsed.data);
});
