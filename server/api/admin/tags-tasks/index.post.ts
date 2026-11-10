import { tagTaskSchema } from "~/shared/tag-task";

export default defineEventHandler(async (event) => {
  const parsed = tagTaskSchema.safeParse(await readBody(event));
  if (!parsed.success)
    throw createError({ statusCode: 400, statusMessage: "Invalid tag task" });

  const tag = await db.tag.findUnique({
    where: { id: parsed.data.tag_id },
    select: { id: true },
  });
  if (!tag)
    throw createError({ statusCode: 404, statusMessage: "Tag not found" });

  return db.tagTask.create({
    data: {
      type: parsed.data.type,
      tagId: parsed.data.tag_id,
      params: parsed.data.params,
    },
    include: { tag: { select: { id: true, name: true } } },
  });
});
