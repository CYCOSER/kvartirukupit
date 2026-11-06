import { tagSchema } from "~/shared/tag";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id)
    throw createError({ statusCode: 404, statusMessage: "Tag not found" });

  const parsed = tagSchema.safeParse(await readBody(event));
  if (!parsed.success)
    throw createError({ statusCode: 400, statusMessage: "Invalid tag" });

  const existing = await db.tag.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing)
    throw createError({ statusCode: 404, statusMessage: "Tag not found" });

  try {
    return await db.tag.update({ where: { id }, data: parsed.data });
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    )
      throw createError({ statusCode: 409, statusMessage: "Tag exists" });
    throw error;
  }
});
