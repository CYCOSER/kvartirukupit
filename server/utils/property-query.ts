import type { Prisma } from "@prisma/client";
import { z } from "zod";

export const propertyQuerySchema = z.object({
  q: z.string().regex(/^[^\u0000-\u001f\u007f]*$/).trim().max(200).optional(),
  type: z.enum(["complex", "apartment"]).optional(),
  location: z.string().max(150).optional(),
  status: z.enum(["available", "reserved", "sold", "all"]).default("available"),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  minArea: z.coerce.number().min(0).optional(),
  maxArea: z.coerce.number().min(0).optional(),
  bedrooms: z.coerce.number().int().min(0).max(100).optional(),
  sort: z.enum(["newest", "price_asc", "price_desc", "area_asc", "area_desc"]).default("newest"),
  featured: z.enum(["true", "false"]).optional(),
  elite: z.enum(["true", "false"]).default("false"),
  page: z.coerce.number().int().min(1).max(10000).default(1),
});

export function propertyQuery(q: z.infer<typeof propertyQuerySchema>) {
  const catalogScope = {
    elite: q.elite === "true",
    ...(q.elite === "true" ? { type: "apartment" } : {}),
  };
  const where: Prisma.PropertyWhereInput = {
    published: true,
    ...(q.status !== "all" ? { status: q.status } : {}),
    ...(q.type ? { type: q.type } : {}),
    ...catalogScope,
    ...(q.q ? { title: { contains: q.q.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" as const } } : {}),
    ...(q.location ? { location: q.location } : {}),
    ...(q.featured === "true" ? { featured: true } : {}),
    ...(q.bedrooms !== undefined ? { bedrooms: { gte: q.bedrooms } } : {}),
    ...(q.minPrice !== undefined || q.maxPrice !== undefined
      ? { price: { gte: q.minPrice, lte: q.maxPrice } } : {}),
    ...(q.minArea !== undefined || q.maxArea !== undefined
      ? { area: { gte: q.minArea, lte: q.maxArea } } : {}),
  };
  const sort: Record<string, Prisma.PropertyOrderByWithRelationInput> = {
    newest: { createdAt: "desc" },
    price_asc: { price: { sort: "asc", nulls: "last" } },
    price_desc: { price: { sort: "desc", nulls: "last" } },
    area_asc: { area: { sort: "asc", nulls: "last" } },
    area_desc: { area: { sort: "desc", nulls: "last" } },
  };
  const orderBy: Prisma.PropertyOrderByWithRelationInput[] = [sort[q.sort]!, { id: "asc" }];
  return { where, catalogScope, orderBy };
}
