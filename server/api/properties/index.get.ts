import { propertyQuery, propertyQuerySchema } from "../../utils/property-query";
import { withPublicTitle } from "../../../shared/property";
import { publicComplexSelect } from "../../utils/property-relations";

export default defineEventHandler(async (event) => {
  const parsed = propertyQuerySchema.safeParse(getQuery(event));
  if (!parsed.success)
    throw createError({ statusCode: 400, statusMessage: "Invalid filters" });
  const { where, catalogScope, orderBy } = propertyQuery(parsed.data);
  const [items, total, locations] = await Promise.all([
    db.property.findMany({
      where,
      orderBy,
      skip: (parsed.data.page - 1) * 12,
      take: 12,
      include: { images: { orderBy: { order: "asc" } }, complex: publicComplexSelect },
    }),
    db.property.count({ where }),
    db.property.findMany({
      where: { published: true, ...catalogScope },
      distinct: ["location"],
      select: { location: true },
      orderBy: { location: "asc" },
    }),
  ]);
  return { items: items.map(withPublicTitle), total, locations: locations.map((p) => p.location), pages: Math.ceil(total / 12) };
});
