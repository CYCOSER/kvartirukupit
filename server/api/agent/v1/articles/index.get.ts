import { createError, defineEventHandler, getQuery } from 'h3';
import type { Prisma } from '@prisma/client';
import { db } from '../../../../utils/db';
import { agentListQuerySchema } from '../../../../utils/agent-query';

export default defineEventHandler(async (event) => {
  const parsed = agentListQuerySchema.safeParse(getQuery(event));
  if (!parsed.success)
    throw createError({ statusCode: 400, statusMessage: 'Invalid query', data: parsed.error.flatten() });
  const { limit, offset, q, slug, published } = parsed.data;
  const where: Prisma.ArticleWhereInput = {
    ...(slug ? { slug } : {}),
    ...(published === undefined ? {} : { published }),
    ...(q ? { OR: ['title', 'slug'].map(field => ({ [field]: { contains: q, mode: 'insensitive' } })) } : {}),
  };
  const [items, total] = await Promise.all([
    db.article.findMany({
      where, take: limit, skip: offset, orderBy: { id: 'asc' },
      select: { id: true, title: true, slug: true, excerpt: true, image: true, published: true, publishedAt: true, updatedAt: true },
    }),
    db.article.count({ where }),
  ]);
  return { items, total, limit, offset };
});
