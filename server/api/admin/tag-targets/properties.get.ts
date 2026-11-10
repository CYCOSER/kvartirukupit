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

  const where = { type: { in: ["complex", "apartment"] } };
  const total = await db.property.count({ where });
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const items =
    page <= lastPage
      ? await db.property.findMany({
          where,
          orderBy: [{ title: "asc" }, { id: "asc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true,
            title: true,
            type: true,
            address: true,
            location: true,
            images: {
              where: { kind: "photo" },
              orderBy: { order: "asc" },
              take: 1,
              select: { file: true },
            },
          },
        })
      : [];

  return { items, total, page, pageSize };
});
