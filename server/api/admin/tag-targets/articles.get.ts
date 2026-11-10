import { createError, defineEventHandler, getQuery } from "h3";
import { db } from "../../../utils/db";

const pageSize = 10;

export default defineEventHandler(async (event) => {
  const rawPage = getQuery(event).page;
  const page =
    rawPage === undefined
      ? 1
      : typeof rawPage === "string" && /^[1-9]\d*$/.test(rawPage)
        ? Number(rawPage)
        : NaN;
  if (!Number.isSafeInteger(page))
    throw createError({ statusCode: 400, statusMessage: "Invalid page" });

  const total = await db.article.count();
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const items =
    page <= lastPage
      ? await db.article.findMany({
          orderBy: [{ title: "asc" }, { id: "asc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true,
            title: true,
            slug: true,
            image: true,
          },
        })
      : [];

  return { items, total, page, pageSize };
});
