import { createError, defineEventHandler, getQuery } from "h3";
import { db } from "../../../utils/db";

export default defineEventHandler((event) => {
  const { type, view } = getQuery(event);
  if (type !== undefined && type !== "complex" && type !== "apartment")
    throw createError({ statusCode: 400, statusMessage: "Invalid property type" });
  if (view !== undefined && view !== "list")
    throw createError({ statusCode: 400, statusMessage: "Invalid property view" });
  const query = {
    where: type ? { type } : undefined,
    orderBy: [{ updatedAt: "desc" as const }, { id: "asc" as const }],
  };
  if (view === "list") {
    // shortcut: compact metadata stays client-side; move filters to the server for catalogs far beyond thousands.
    return db.property.findMany({
      ...query,
      select: {
        id: true, title: true, type: true, location: true, address: true,
        price: true, area: true, status: true, published: true, featured: true,
        elite: true, housingMarket: true, demo: true, sourceUrl: true, sourceName: true,
        images: { orderBy: { order: "asc" }, take: 1, select: { file: true } },
      },
    });
  }
  return db.property.findMany({
    ...query,
    include: { images: { orderBy: { order: "asc" } } },
  });
});
