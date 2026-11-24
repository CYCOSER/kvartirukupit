import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';
import { propertyFeatureSchema } from '../../../../shared/property-feature';
import { renamePropertyFeature } from '../../../utils/tag-definitions';

export default defineEventHandler(async event => {
  const parsed = propertyFeatureSchema.pick({ name: true }).strict().safeParse(await readBody(event));
  if (!parsed.success) throw createError({ statusCode: 400, data: { message: 'Укажите название значка. Группу менять нельзя.' } });
  return renamePropertyFeature(getRouterParam(event, 'id')!, parsed.data.name);
});
