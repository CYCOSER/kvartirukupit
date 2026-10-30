import { defineEventHandler, readBody, createError } from "h3";
import { z } from "zod";
import { db } from "../../../utils/db";

const schema = z
  .object({
    action: z.enum(["publish", "unpublish", "delete"]),
    ids: z.array(z.string().trim().min(1).max(100)).min(1).max(500),
  })
  .strict();

export default defineEventHandler(async (event) => {
  const parsed = schema.safeParse(await readBody(event));
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid bulk action",
    });
  }
  const { action, ids } = parsed.data;
  const where = { id: { in: ids } };
  if (action === "delete") return db.property.deleteMany({ where });
  return db.property.updateMany({
    where,
    data: { published: action === "publish" },
  });
});
