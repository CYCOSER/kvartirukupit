import { createError, defineEventHandler, readBody } from 'h3';
import { propertyFeatureSchema } from '../../../../shared/property-feature';
import { createTagDefinition } from '../../../utils/tag-definitions';

export default defineEventHandler(async event => {
  const parsed = propertyFeatureSchema.strict().safeParse(await readBody(event));
  if (!parsed.success) throw createError({ statusCode: 400, data: { message: 'Укажите название значка и группу.' } });
  const tag = await createTagDefinition({ name: parsed.data.name, propertyFeature: parsed.data });
  return tag.propertyFeature;
});
