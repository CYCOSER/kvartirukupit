import { manualTagRelationsSchema } from "~/shared/tag";

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
    const tag = await tx.tag.findUnique({
      where: { id: parsed.data.tag_id },
      select: { id: true },
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

    const [properties, articles] = await Promise.all([
      propertyIds.length
        ? tx.tagRelation.createMany({
            data: propertyIds.map((propertyId) => ({
              tagId: tag.id,
              propertyId,
            })),
            skipDuplicates: true,
          })
        : { count: 0 },
      articleIds.length
        ? tx.tagRelation.createMany({
            data: articleIds.map((articleId) => ({
              tagId: tag.id,
              articleId,
            })),
            skipDuplicates: true,
          })
        : { count: 0 },
    ]);

    return {
      propertyRelationsCreated: properties.count,
      articleRelationsCreated: articles.count,
    };
  });
});
