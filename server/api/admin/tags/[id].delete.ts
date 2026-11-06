export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id)
    throw createError({ statusCode: 404, statusMessage: "Tag not found" });

  const deleted = await db.tag.deleteMany({ where: { id } });
  if (!deleted.count)
    throw createError({ statusCode: 404, statusMessage: "Tag not found" });

  return { ok: true };
});
