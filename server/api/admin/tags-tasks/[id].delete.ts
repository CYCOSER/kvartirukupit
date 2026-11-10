export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id)
    throw createError({ statusCode: 404, statusMessage: "Task not found" });

  const deleted = await db.tagTask.deleteMany({ where: { id } });
  if (!deleted.count)
    throw createError({ statusCode: 404, statusMessage: "Task not found" });

  return { ok: true };
});
