import { leadSchema } from '~/shared/property';
import { verifyLeadCaptcha } from '../utils/captcha';
export default defineEventHandler(async (event) => {
  checkOrigin(event);
  limit(event, 'lead');
  const parsed = leadSchema.safeParse(await readBody(event));
  if (!parsed.success)
    throw createError({ statusCode: 400, statusMessage: 'Check your details' });
  const { website, purpose, captchaToken, ...data } = parsed.data;
  if (website) return { ok: true };
  if (
    data.propertyId &&
    !(await db.property.findFirst({
      where: { id: data.propertyId, published: true, status: { not: 'sold' } },
    }))
  )
    throw createError({ statusCode: 400, statusMessage: 'Object unavailable' });
  await verifyLeadCaptcha(event, captchaToken);
  await db.lead.create({
    data: {
      ...data,
      phone: data.phone.replace(/[^\d+]/g, ''),
      consentVersion: '2026-11-16',
    },
  });
  return { ok: true };
});
