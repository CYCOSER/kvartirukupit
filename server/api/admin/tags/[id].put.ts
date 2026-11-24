import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { tagUpdateSchema } from '../../../../shared/tag';
import { updateTagDefinition } from '../../../utils/tag-definitions';

export default defineEventHandler(async event => {
  const parsed = tagUpdateSchema.safeParse(await readBody(event));
  if (!parsed.success) throw createError({ statusCode: 400, data: { message: 'Укажите названия. Тип и группу существующего тега менять нельзя.' } });
  return updateTagDefinition(getRouterParam(event, 'id')!, parsed.data);
});
