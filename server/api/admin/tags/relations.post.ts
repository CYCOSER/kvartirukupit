import { createError, defineEventHandler, readBody } from 'h3';
import { db } from '../../../utils/db';
import { manualTagRelationsSchema } from '../../../../shared/tag';
import { assignTagTargets } from '../../../utils/tag-assignments';
import { tagInclude } from '../../../utils/tag-definitions';
import { lockPropertyRelations } from '../../../utils/property-relations';

export default defineEventHandler(async (event) => {
  const parsed = manualTagRelationsSchema.safeParse(await readBody(event));
  if (!parsed.success)
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid manual tag assignment",
    });

  const propertyIds = [...new Set(parsed.data.property_ids)];
  const articleIds = [...new Set(parsed.data.article_ids)];

  return db.$transaction(async (tx) => {
    await lockPropertyRelations(tx);
    const tag = await tx.tag.findUnique({
      where: { id: parsed.data.tag_id },
      include: tagInclude,
    });
    if (!tag)
      throw createError({ statusCode: 404, statusMessage: "Tag not found" });

    const [propertyCount, articleCount] = await Promise.all([
      propertyIds.length
        ? tx.property.count({ where: { id: { in: propertyIds } } })
        : 0,
      articleIds.length
        ? tx.article.count({ where: { id: { in: articleIds } } })
        : 0,
    ]);
    if (
      propertyCount !== propertyIds.length ||
      articleCount !== articleIds.length
    )
      throw createError({
        statusCode: 400,
        statusMessage: "One or more selected targets do not exist",
      });

    return assignTagTargets(tx, tag, propertyIds, articleIds, 'manual');
  }, { timeout: 60_000 });
});
