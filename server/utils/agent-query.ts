import { z } from 'zod';

export const agentListQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/).default('20').transform(Number).pipe(z.number().int().min(1).max(100)),
  offset: z.string().regex(/^\d+$/).default('0').transform(Number).pipe(z.number().int().min(0).max(2147483647)),
  q: z.string().trim().max(200).optional(),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(150).optional(),
  published: z.enum(['true', 'false']).transform(value => value === 'true').optional(),
}).strict();
