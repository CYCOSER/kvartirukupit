import type { Prisma } from '@prisma/client';
import { createError, defineEventHandler, getQuery } from 'h3';
import { z } from 'zod';
import { db } from '../../../../utils/db';
import { agentListQuerySchema } from '../../../../utils/agent-query';

const querySchema = agentListQuerySchema.extend({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120).optional(),
  type: z.enum(['complex', 'apartment']).optional(),
});

export default defineEventHandler(async (event) => {
  const parsed = querySchema.safeParse(getQuery(event));
  if (!parsed.success)
    throw createError({ statusCode: 400, statusMessage: 'Invalid query', data: parsed.error.flatten() });
  const { limit, offset, q, slug, type, published } = parsed.data;
  const where: Prisma.PropertyWhereInput = {
    ...(slug ? { slug } : {}),
    ...(type ? { type } : {}),
    ...(published !== undefined ? { published } : {}),
    ...(q ? { OR: ['title', 'location', 'address'].map(field => ({ [field]: { contains: q, mode: 'insensitive' } })) } : {}),
  };
  const [items, total] = await Promise.all([
    db.property.findMany({
      where, take: limit, skip: offset,
      orderBy: { id: 'asc' },
      select: {
        id: true, title: true, slug: true, type: true, location: true,
        address: true, published: true, updatedAt: true,
      },
    }),
    db.property.count({ where }),
  ]);
  return { items, total, limit, offset };
});
