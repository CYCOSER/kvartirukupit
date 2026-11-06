import { tagSchema } from "~/shared/tag";

export default defineEventHandler(async (event) => {
  const parsed = tagSchema.safeParse(await readBody(event));
  if (!parsed.success)
    throw createError({ statusCode: 400, statusMessage: "Invalid tag" });

  try {
    return await db.tag.create({ data: parsed.data });
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
