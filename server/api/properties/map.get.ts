import { propertyQuery, propertyQuerySchema } from "../../utils/property-query";
import { withPublicTitle } from "../../../shared/property";
import { publicComplexSelect } from "../../utils/property-relations";

export default defineEventHandler(async (event) => {
  const parsed = propertyQuerySchema.safeParse(getQuery(event));
  if (!parsed.success)
    throw createError({ statusCode: 400, statusMessage: "Invalid filters" });
  const { where, catalogScope, orderBy } = propertyQuery(parsed.data);
  const [items, locations] = await Promise.all([
    db.property.findMany({
      where,
      orderBy,
      select: {
        id: true, slug: true, title: true, type: true, location: true,
        address: true, price: true, priceKind: true, area: true, bedrooms: true,
        status: true, elite: true, latitude: true, longitude: true,
        developer: true, constructionStatus: true, priceArea: true, readiness: true, sourceMode: true,
        complex: publicComplexSelect,
        images: { orderBy: { order: "asc" }, take: 1, select: { id: true, file: true, alt: true, order: true, kind: true } },
      },
    }),
    db.property.findMany({
      where: { published: true, ...catalogScope },
      distinct: ["location"],
      select: { location: true },
      orderBy: { location: "asc" },
    }),
  ]);
  return { items: items.map(withPublicTitle), total: items.length, locations: locations.map((p) => p.location), pages: 1 };
});
