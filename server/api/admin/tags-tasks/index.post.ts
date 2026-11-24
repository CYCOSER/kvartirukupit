import { createError, defineEventHandler, readBody } from 'h3';
import { db } from '../../../utils/db';
import { tagTaskSchema } from '../../../../shared/tag-task';
import { tagInclude } from '../../../utils/tag-definitions';

export default defineEventHandler(async (event) => {
  const parsed = tagTaskSchema.safeParse(await readBody(event));
  if (!parsed.success)
    throw createError({ statusCode: 400, statusMessage: "Invalid tag task" });

  const tag = await db.tag.findUnique({
    where: { id: parsed.data.tag_id },
    select: { id: true, propertyFeatureId: true },
  });
  if (!tag)
    throw createError({ statusCode: 404, statusMessage: "Tag not found" });
  if (tag.propertyFeatureId && parsed.data.type === 'article')
    throw createError({ statusCode: 400, data: { message: 'Значки характеристик нельзя назначать статьям.' } });

  return db.tagTask.create({
    data: {
      type: parsed.data.type,
      tagId: parsed.data.tag_id,
      params: parsed.data.params,
    },
    include: { tag: { include: tagInclude } },
  });
});
