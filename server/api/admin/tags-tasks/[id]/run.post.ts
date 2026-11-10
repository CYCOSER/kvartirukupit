import { runTagTask } from "~/server/utils/run-tag-task";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id)
    throw createError({ statusCode: 404, statusMessage: "Task not found" });

  const task = await db.tagTask.findUnique({
    where: { id },
    select: { type: true, params: true, tagId: true },
  });
  if (!task)
    throw createError({ statusCode: 404, statusMessage: "Task not found" });

  return runTagTask(task);
});
