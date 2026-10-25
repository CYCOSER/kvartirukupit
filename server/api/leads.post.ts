import { leadSchema } from '~/shared/property';
export default defineEventHandler(async (event) => {
  checkOrigin(event);
  limit(event, 'lead');
  const parsed = leadSchema.safeParse(await readBody(event));
  if (!parsed.success)
    throw createError({ statusCode: 400, statusMessage: 'Check your details' });
  const { website, purpose, ...data } = parsed.data;
  if (website) return { ok: true };
  if (
    data.propertyId &&
    !(await db.property.findFirst({
      where: { id: data.propertyId, published: true, status: { not: 'sold' } },
    }))
  )
    throw createError({ statusCode: 400, statusMessage: 'Object unavailable' });
  await db.lead.create({
    data: {
      ...data,
      phone: data.phone.replace(/[^\d+]/g, ''),
      consentVersion: '2026-10-25',
    },
  });
  return { ok: true };
});
